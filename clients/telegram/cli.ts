import { Bot, type Context } from 'grammy';
import { FileFlavor, hydrateFiles } from '@grammyjs/files';
import {
  ping,
  createThread,
  type Thread,
  type PromptInput,
} from '../agent-sdk';
import { pipeline } from '@xenova/transformers';
import ffmpeg from 'fluent-ffmpeg';
import pc from 'picocolors';
import fs from 'node:fs';
import { getTelegramEnv } from './utilities';

type BotContext = FileFlavor<Context>;

const { botToken, senderId } = getTelegramEnv();

if (!(await ping())) {
  console.error('Agent is not running.');
  process.exit(1);
}

const bot = new Bot<BotContext>(botToken);
const transcriber = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-small'
);

bot.api.config.use(hydrateFiles(bot.token));

const thread: Thread = await createThread();

bot.on('message:text', async (ctx) => {
  if (ctx.from?.id.toString() !== senderId) {
    console.log(
      `401: Received: ${ctx.message.text} from ${ctx.from?.username} (${ctx.from?.id}) but not allowed to send messages to the bot`
    );
    return;
  }

  if (!(await ping())) {
    await ctx.reply('Agent is not running');
    process.exit(1);
  }

  const message = ctx.message;
  handoffToAgent({ content: message.text, images: [] }, ctx);
});

bot.on('message:voice', async (ctx) => {
  if (ctx.from?.id.toString() !== senderId) {
    console.log(
      `401: Received: ${ctx.message.text} from ${ctx.from?.username} (${ctx.from?.id}) but not allowed to send messages to the bot`
    );
    return;
  }

  const voice = ctx.message.voice;

  console.log('Received voice message:', {
    duration: voice.duration,
    mimeType: voice.mime_type,
    fileSize: voice.file_size,
    fileId: voice.file_id,
  });

  const file = await ctx.getFile();
  await file.download('./temp.ogg');

  await oggToRawPcm('./temp.ogg', './temp.pcm');
  const audioData = await readAudioAsFloat32('./temp.pcm');

  const result = (await transcriber(audioData, {
    return_timestamps: false,
  })) as { text: string };

  handoffToAgent({ content: result.text.trim(), images: [] }, ctx);

  fs.unlinkSync('./temp.ogg');
  fs.unlinkSync('./temp.pcm');
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

async function processPhotoMessage(ctx: BotContext) {
  const photos = ctx.message.photo;
  const largestPhoto = photos[photos.length - 1];
  const file = await ctx.api.getFile(largestPhoto.file_id);
  const imageBuffer = await downloadFileToBuffer(file);
  const base64 = imageBuffer.toString('base64');
  return { base64, caption: ctx.message.caption ?? undefined };
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
  await handoffToAgent({ content: caption, images }, replyCtx);
}

bot.on('message:photo', async (ctx) => {
  if (ctx.from?.id.toString() !== senderId) {
    console.log(
      `401: Received photo from ${ctx.from?.username} (${ctx.from?.id}) but not allowed to send messages to the bot`
    );
    return;
  }

  if (!(await ping())) {
    await ctx.reply('Agent is not running');
    process.exit(1);
  }

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
  await handoffToAgent(
    {
      content: caption || 'User sent an image.',
      images: [{ data: base64, mimeType: 'image/jpeg' }],
    },
    ctx
  );
});

bot.start();
console.log('Ready.');

await handoffToAgent({
  content:
    '<system_instructions>You just started. Check recent notes for context and greet me.</system_instructions>',
  images: [],
});

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

async function handoffToAgent(input: PromptInput, ctx?: BotContext) {
  const imageSuffix =
    input.images.length > 0 ? ` [+${input.images.length} image(s)]` : '';
  const preview = `${input.content}${imageSuffix}`;

  console.log(`\n\nPrompting: "${preview}"`);

  const message = `Sending response to ${ctx ? ctx.from?.username : 'user'}...`;
  let response = '';

  await thread.prompt(input, {
    onThinking: (chunk: string) => {
      ctx?.api.sendChatAction(ctx.chat.id, 'typing');
    },
    onContent: (chunk: string) => {
      ctx?.api.sendChatAction(ctx.chat.id, 'typing');
      response += chunk;
    },
    onToolcall: async () => {
      if (response.trim() !== '') {
        process.stdout.write(`\n\n${message} (partial response)`);
        const text = response;
        response = '';
        await send(text);
      }
    },
    onDone: async () => {
      if (response.trim() !== '') {
        console.log(`\n\n${message}`);
        console.log(`"${response}"`);
        await send(response);
      }
      response = '';
      process.stdout.write(`done. ${pc.green('✓')}\n`);
    },
    onError: async (error: string) => {
      if (error) {
        console.error(pc.red(`Error: ${error}`));
        await send(error);
      }
      response = '';
    },
  });

  function send(text: string) {
    if (ctx) {
      return ctx.reply(text);
    } else {
      return bot.api.sendMessage(senderId, text);
    }
  }
}
