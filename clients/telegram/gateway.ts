import { Bot } from 'grammy';
import { hydrateFiles } from '@grammyjs/files';
import { ping } from '../../gateway/sdk/sdk';
import { createPromper, type BotContext } from './prompt';
import { pipeline } from '@xenova/transformers';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTelegramEnv, telegramAwaitSocketPath } from './utilities';
import { TaskChannel } from '../TaskChannel';
import { sendMessage } from './utilities';
import { createLogger } from '../../utilities/logger';

const logger = createLogger('TG');

type PromptFn = (
  args: {
    content: string;
    images: { data: string; mimeType: string }[];
  },
  ctx?: BotContext
) => Promise<void> | void;

export class TelegramGateway {
  private readonly bot: Bot<BotContext>;
  private readonly prompt: PromptFn;
  private readonly taskChannel: TaskChannel<{
    text: string;
    messageThreadId?: number;
  }>;
  private readonly mediaGroupCollector = new Map<
    string,
    { contexts: BotContext[]; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly senderId: string;
  private readonly transcriber: (
    audio: Float32Array,
    options: { return_timestamps: boolean }
  ) => Promise<unknown>;
  private lastMessageThreadId: number | null = null;

  constructor(
    bot: Bot<BotContext>,
    prompt: PromptFn,
    senderId: string,
    transcriber: (
      audio: Float32Array,
      options: { return_timestamps: boolean }
    ) => Promise<unknown>
  ) {
    this.bot = bot;
    this.prompt = prompt;
    this.senderId = senderId;
    this.transcriber = transcriber;
    this.taskChannel = new TaskChannel<{
      text: string;
      messageThreadId?: number;
    }>(telegramAwaitSocketPath);
  }

  static async create(): Promise<TelegramGateway> {
    const env = getTelegramEnv();
    const botToken = env.botToken;
    const senderId = env.senderId;

    const bot = new Bot<BotContext>(botToken);
    bot.api.config.use(hydrateFiles(bot.token));

    const transcriber = (await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-small'
    )) as TelegramGateway['transcriber'];

    const prompt: PromptFn = await createPromper(bot);

    return new TelegramGateway(bot, prompt, senderId, transcriber);
  }

  async start(): Promise<void> {
    this.registerTaskHandlers();
    this.registerTextHandler();
    this.registerVoiceHandler();
    this.registerPhotoHandler();

    this.taskChannel.listen();
    this.bot.start();

    logger.log('Ready.');
  }

  private isAllowedSender(ctx: BotContext): boolean {
    return ctx.from?.id.toString() === this.senderId;
  }

  private rejectUnauthorized(ctx: BotContext, label: string): void {
    logger.log(
      `401: ${label} from ${ctx.from?.username} (${ctx.from?.id}) but not allowed to send messages to the bot`
    );
  }

  private registerTaskHandlers(): void {
    this.taskChannel.onTask('await-reply', async ({ text }) => {
      await sendMessage(text, {
        threadId: this.lastMessageThreadId ?? undefined,
      });
    });

    this.taskChannel.onTask('send-message', async ({ text }) => {
      await sendMessage(text, {
        threadId: this.lastMessageThreadId ?? undefined,
      });
    });

    this.taskChannel.onTask('edit-topic', async ({ text }) => {
      if (!this.lastMessageThreadId) {
        logger.warn('edit-topic requested but lastMessageThreadId is not set');
        return;
      }
      let title = text;
      let emoji: string | undefined;

      try {
        const parsed = JSON.parse(text as string) as {
          title?: unknown;
          emoji?: unknown;
        };
        if (typeof parsed === 'object' && parsed !== null) {
          if (typeof parsed.title === 'string') {
            title = parsed.title;
          }
          if (typeof parsed.emoji === 'string') {
            emoji = parsed.emoji;
          }
        }
      } catch {
        // Fallback: treat raw as the plain title string for backwards compatibility.
      }

      await this.bot.api.editForumTopic(
        this.senderId,
        this.lastMessageThreadId,
        {
          name: title,
          ...(emoji ? { icon_custom_emoji_id: emoji } : {}),
        }
      );
    });
  }

  private registerTextHandler(): void {
    this.bot.on('message:text', async (ctx) => {
      if (!this.isAllowedSender(ctx)) {
        this.rejectUnauthorized(ctx, `Received: ${ctx.message.text}`);
        return;
      }

      const text = ctx.message.text ?? '';
      this.lastMessageThreadId = ctx.message.message_thread_id ?? null;

      if (
        this.taskChannel.onIncomingMessage({
          text,
          messageThreadId: ctx.message.message_thread_id,
        }).handledByChannel
      )
        return;

      if (!(await ping())) {
        await ctx.reply('Agent is not running');
        process.exit(1);
      }

      this.prompt({ content: text, images: [] }, ctx);
    });
  }

  private registerVoiceHandler(): void {
    this.bot.on('message:voice', async (ctx) => {
      if (!this.isAllowedSender(ctx)) {
        this.rejectUnauthorized(ctx, 'Received voice message');
        return;
      }

      const voice = ctx.message.voice;

      logger.log('Received voice message:', {
        duration: voice.duration,
        mimeType: voice.mime_type,
        fileSize: voice.file_size,
        fileId: voice.file_id,
      });

      const chat = ctx.chat;
      if (!chat) return;
      await ctx.api.sendChatAction(chat.id, 'upload_voice');

      const paths = {
        ogg: path.join(tmpdir(), `greg-telegram-${ctx.message.message_id}.ogg`),
        pcm: path.join(tmpdir(), `greg-telegram-${ctx.message.message_id}.pcm`),
      };

      const file = await ctx.getFile();
      await file.download(paths.ogg);

      await oggToRawPcm(paths.ogg, paths.pcm);
      const audioData = await readAudioAsFloat32(paths.pcm);

      const result = (await this.transcriber(audioData, {
        return_timestamps: false,
      })) as { text: string };

      this.prompt({ content: result.text.trim(), images: [] }, ctx);

      fs.unlinkSync(paths.ogg);
      fs.unlinkSync(paths.pcm);
    });
  }

  private registerPhotoHandler(): void {
    this.bot.on('message:photo', async (ctx) => {
      if (!this.isAllowedSender(ctx)) {
        this.rejectUnauthorized(ctx, 'Received photo');
        return;
      }

      if (!(await ping())) {
        await ctx.reply('Agent is not running');
        process.exit(1);
      }

      ctx.api.sendChatAction(ctx.chat.id, 'upload_photo');

      const mediaGroupId = ctx.message.media_group_id;

      if (mediaGroupId) {
        const existing = this.mediaGroupCollector.get(mediaGroupId);
        if (existing) {
          existing.contexts.push(ctx);
          clearTimeout(existing.timer);
          existing.timer = setTimeout(() => {
            this.mediaGroupCollector.delete(mediaGroupId);
            const contexts = existing.contexts;
            this.processPhotoBatch(contexts, contexts[0]).catch((err) => {
              logger.error('Error processing photo batch:', err);
              contexts[0]
                .reply('Failed to process images.')
                .catch(logger.error);
            });
          }, 400);
        } else {
          const timer = setTimeout(() => {
            this.mediaGroupCollector.delete(mediaGroupId);
            this.processPhotoBatch([ctx], ctx).catch((err) => {
              logger.error('Error processing photo batch:', err);
              ctx.reply('Failed to process images.').catch(logger.error);
            });
          }, 400);
          this.mediaGroupCollector.set(mediaGroupId, {
            contexts: [ctx],
            timer,
          });
        }
        return;
      }

      const { base64, caption } = await processPhotoMessage(ctx);
      await this.prompt(
        {
          content: caption || 'User sent an image.',
          images: [{ data: base64, mimeType: 'image/jpeg' }],
        },
        ctx
      );
    });
  }

  private async processPhotoBatch(
    contexts: BotContext[],
    replyCtx: BotContext
  ): Promise<void> {
    const results = await Promise.all(contexts.map(processPhotoMessage));
    const caption =
      results.map((r) => r.caption).find(Boolean) ||
      (contexts.length > 1
        ? `User sent ${contexts.length} images.`
        : 'User sent an image.');
    const images = results.map((r) => ({
      data: r.base64,
      mimeType: 'image/jpeg' as const,
    }));
    await this.prompt({ content: caption, images }, replyCtx);
  }
}

export async function start(): Promise<void> {
  const gateway = await TelegramGateway.create();
  await gateway.start();
}

async function downloadFileToBuffer(file: {
  getUrl: () => string;
}): Promise<Buffer> {
  const url = file.getUrl();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function processPhotoMessage(ctx: BotContext): Promise<{
  base64: string;
  caption: string | undefined;
}> {
  const message = ctx.message;
  if (!message) throw new Error('No message on context');
  const photos = message.photo;
  if (!photos?.length) throw new Error('No photos in message');
  const largestPhoto = photos[photos.length - 1];
  const file = await ctx.api.getFile(largestPhoto.file_id);
  const imageBuffer = await downloadFileToBuffer(file);
  const base64 = imageBuffer.toString('base64');
  return { base64, caption: message.caption ?? undefined };
}

function oggToRawPcm(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', () => resolve())
      .on('error', reject)
      .save(output);
  });
}

async function readAudioAsFloat32(pcmPath: string): Promise<Float32Array> {
  const buffer = await fs.promises.readFile(pcmPath);
  const int16Array = new Int16Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / 2
  );

  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  return float32Array;
}
