import { createPromper } from './prompt';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from '../../utilities/logger';
import { sendMessage } from './messaging';
import { bot, senderId, type BotContext } from './bot';

const logger = createLogger('TG');

type PromptFn = (
  args: {
    content: string;
    images: { data: string; mimeType: string }[];
  },
  ctx?: BotContext
) => Promise<void> | void;

export class TelegramGateway {
  private readonly prompt: PromptFn;
  private readonly mediaGroupCollector = new Map<
    string,
    { contexts: BotContext[]; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly transcriber: (
    audio: Float32Array,
    options: { return_timestamps: boolean }
  ) => Promise<unknown>;
  private messageInterceptor: ((text: string) => void) | null = null;

  constructor(
    prompt: PromptFn,
    transcriber: (
      audio: Float32Array,
      options: { return_timestamps: boolean }
    ) => Promise<unknown>
  ) {
    this.prompt = prompt;
    this.transcriber = transcriber;
  }

  static async create(): Promise<TelegramGateway> {
    const { pipeline } = await import('@xenova/transformers');

    const transcriber = (await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-small'
    )) as TelegramGateway['transcriber'];

    const prompt: PromptFn = createPromper();

    return new TelegramGateway(prompt, transcriber);
  }

  start(): Promise<void> {
    this.registerTextHandler();
    this.registerVoiceHandler();
    this.registerPhotoHandler();
    void bot.start();
    return Promise.resolve();
  }

  async getReply(text: string): Promise<string> {
    await sendMessage(text, {
      type: 'markdown',
    });
    return new Promise<string>((resolve) => {
      this.messageInterceptor = (text: string) => { resolve(text); };
    });
  }

  private isAllowedSender(ctx: BotContext): boolean {
    return ctx.from?.id.toString() === senderId;
  }

  private rejectUnauthorized(ctx: BotContext, label: string): void {
    logger.log(
      `401: ${label} from ${ctx.from?.username} (${ctx.from?.id}) but not allowed to send messages to the bot`
    );
  }

  private registerTextHandler(): void {
    bot.on('message:text', (ctx) => {
      if (!this.isAllowedSender(ctx)) {
        this.rejectUnauthorized(ctx, `Received: ${ctx.message.text}`);
        return;
      }

      const text = ctx.message.text;

      if (this.messageInterceptor) {
        this.messageInterceptor(text);
        this.messageInterceptor = null;
        return;
      }

      void this.prompt({ content: text, images: [] }, ctx);
    });
  }

  private registerVoiceHandler(): void {
    bot.on('message:voice', async (ctx) => {
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

      await ctx.api.sendChatAction(ctx.chat.id, 'upload_voice');

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

      void this.prompt({ content: result.text.trim(), images: [] }, ctx);

      fs.unlinkSync(paths.ogg);
      fs.unlinkSync(paths.pcm);
    });
  }

  private registerPhotoHandler(): void {
    bot.on('message:photo', async (ctx) => {
      if (!this.isAllowedSender(ctx)) {
        this.rejectUnauthorized(ctx, 'Received photo');
        return;
      }

      void ctx.api.sendChatAction(ctx.chat.id, 'upload_photo');

      const mediaGroupId = ctx.message.media_group_id;

      if (mediaGroupId) {
        const existing = this.mediaGroupCollector.get(mediaGroupId);
        if (existing) {
          existing.contexts.push(ctx);
          clearTimeout(existing.timer);
          existing.timer = setTimeout(() => {
            this.mediaGroupCollector.delete(mediaGroupId);
            const contexts = existing.contexts;
            this.processPhotoBatch(contexts, contexts[0]).catch((err: unknown) => {
              logger.error(
                'Error processing photo batch:',
                err instanceof Error ? err : String(err)
              );
              contexts[0]
                .reply('Failed to process images.')
                .catch(logger.error);
            });
          }, 400);
        } else {
          const timer = setTimeout(() => {
            this.mediaGroupCollector.delete(mediaGroupId);
            this.processPhotoBatch([ctx], ctx).catch((err: unknown) => {
              logger.error(
                'Error processing photo batch:',
                err instanceof Error ? err : String(err)
              );
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
      const content =
        caption != null && caption.trim() !== ''
          ? caption
          : 'User sent an image.';
      await this.prompt(
        {
          content,
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
    const captionFromResults = results
      .map((r) => r.caption)
      .find((c) => c != null && c.trim() !== '');
    const caption =
      captionFromResults ??
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
      .on('end', () => { resolve(); })
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
