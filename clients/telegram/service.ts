import { Bot } from 'grammy';
import { hydrateFiles } from '@grammyjs/files';
import { ping } from '../agent-sdk';
import { createPromper, type BotContext } from './prompt';
import { pipeline } from '@xenova/transformers';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import {
  escapeMarkdownV2,
  getTelegramEnv,
  telegramAwaitSocketPath,
} from './utilities';
import { TaskChannel } from './TaskChannel';

const env = getTelegramEnv();
const botToken = env.botToken;
const senderId = env.senderId;

const bot = new Bot<BotContext>(botToken);
const transcriber = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-small'
);

bot.api.config.use(hydrateFiles(bot.token));
bot.api.config.use((prev, method, payload, signal) =>
  prev(method, { parse_mode: 'MarkdownV2', ...payload }, signal)
);

const prompt = await createPromper(bot);

function isAllowedSender(ctx: BotContext): boolean {
  return ctx.from?.id.toString() === senderId;
}

function rejectUnauthorized(ctx: BotContext, label: string): void {
  console.log(
    `401: ${label} from ${ctx.from?.username} (${ctx.from?.id}) but not allowed to send messages to the bot`
  );
}

const taskChannel = new TaskChannel<{
  messageThreadId?: number;
}>(telegramAwaitSocketPath);

let lastMessageThreadId: number | null = null;

taskChannel.onTask('await-reply', async (text) => {
  const escaped = escapeMarkdownV2(text);
  await bot.api.sendMessage(senderId, escaped, {
    message_thread_id: lastMessageThreadId ?? undefined,
  });
});

taskChannel.onTask('send-message', async (text) => {
  const escaped = escapeMarkdownV2(text);
  await bot.api.sendMessage(senderId, escaped, {
    message_thread_id: lastMessageThreadId ?? undefined,
  });
});

taskChannel.onTask('edit-topic', async (raw) => {
  if (!lastMessageThreadId) {
    console.warn('edit-topic requested but lastMessageThreadId is not set');
    return;
  }
  let title = raw;
  let emoji: string | undefined;

  try {
    const parsed = JSON.parse(raw as string) as {
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

  await bot.api.editForumTopic(senderId, lastMessageThreadId, {
    name: title,
    ...(emoji ? { icon_custom_emoji_id: emoji } : {}),
  });
});

taskChannel.listen();

bot.on('message:text', async (ctx) => {
  if (!isAllowedSender(ctx)) {
    rejectUnauthorized(ctx, `Received: ${ctx.message.text}`);
    return;
  }

  const text = ctx.message.text ?? '';
  lastMessageThreadId = ctx.message.message_thread_id ?? null;

  if (
    taskChannel.onIncomingMessage(text, {
      messageThreadId: ctx.message.message_thread_id,
    }).handledByChannel
  )
    return;

  if (!(await ping())) {
    await ctx.reply('Agent is not running');
    process.exit(1);
  }

  prompt({ content: text, images: [] }, ctx);
});

bot.on('message:voice', async (ctx) => {
  if (!isAllowedSender(ctx)) {
    rejectUnauthorized(ctx, 'Received voice message');
    return;
  }

  const voice = ctx.message.voice;

  console.log('Received voice message:', {
    duration: voice.duration,
    mimeType: voice.mime_type,
    fileSize: voice.file_size,
    fileId: voice.file_id,
  });

  const chat = ctx.chat;
  if (!chat) return;
  await ctx.api.sendChatAction(chat.id, 'upload_voice');

  const paths = {
    ogg: `/tmp/greg-telegram-${ctx.message.message_id}.ogg`,
    pcm: `/tmp/greg-telegram-${ctx.message.message_id}.pcm`,
  };

  const file = await ctx.getFile();
  await file.download(paths.ogg);

  await oggToRawPcm(paths.ogg, paths.pcm);
  const audioData = await readAudioAsFloat32(paths.pcm);

  const result = (await transcriber(audioData, {
    return_timestamps: false,
  })) as { text: string };

  prompt({ content: result.text.trim(), images: [] }, ctx);

  fs.unlinkSync(paths.ogg);
  fs.unlinkSync(paths.pcm);
});

const mediaGroupCollector = new Map<
  string,
  { contexts: BotContext[]; timer: ReturnType<typeof setTimeout> }
>();

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

async function processPhotoBatch(contexts: BotContext[], replyCtx: BotContext) {
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
  await prompt({ content: caption, images }, replyCtx);
}

bot.on('message:photo', async (ctx) => {
  if (!isAllowedSender(ctx)) {
    rejectUnauthorized(ctx, 'Received photo');
    return;
  }

  if (!(await ping())) {
    await ctx.reply('Agent is not running');
    process.exit(1);
  }

  ctx.api.sendChatAction(ctx.chat.id, 'upload_photo');

  const mediaGroupId = ctx.message.media_group_id;

  if (mediaGroupId) {
    const existing = mediaGroupCollector.get(mediaGroupId);
    if (existing) {
      existing.contexts.push(ctx);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        mediaGroupCollector.delete(mediaGroupId);
        const contexts = existing.contexts;
        processPhotoBatch(contexts, contexts[0]).catch((err) => {
          console.error('Error processing photo batch:', err);
          contexts[0].reply('Failed to process images.').catch(console.error);
        });
      }, 400);
    } else {
      const timer = setTimeout(() => {
        mediaGroupCollector.delete(mediaGroupId);
        processPhotoBatch([ctx], ctx).catch((err) => {
          console.error('Error processing photo batch:', err);
          ctx.reply('Failed to process images.').catch(console.error);
        });
      }, 400);
      mediaGroupCollector.set(mediaGroupId, { contexts: [ctx], timer });
    }
    return;
  }

  const { base64, caption } = await processPhotoMessage(ctx);
  await prompt(
    {
      content: caption || 'User sent an image.',
      images: [{ data: base64, mimeType: 'image/jpeg' }],
    },
    ctx
  );
});

bot.start();
console.log('Ready.');

if (await ping()) {
  prompt({
    content: 'You just started. Check recent notes for context and greet me.',
    images: [],
  });
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
