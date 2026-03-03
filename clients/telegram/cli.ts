import { Bot, type Context } from 'grammy';
import { FileFlavor, hydrateFiles } from '@grammyjs/files';
import { ping, createThread, type Thread } from '../agent-sdk';
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

const llmState = { working: false, response: '' };
const bot = new Bot<BotContext>(botToken);

let thread: Thread | null = null;

async function getOrCreateThread(): Promise<Thread> {
  if (!thread) thread = await createThread();
  return thread;
}

bot.api.config.use(hydrateFiles(bot.token));

const transcriber = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-small'
);

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

  if (message.text === '/stop') {
    const success = thread ? await thread.abort() : true;
    await ctx.reply(success ? 'Okay. Stopping.' : 'Failed to stop.');
    return;
  }

  handoffToAgent(message.text, ctx);
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

  handoffToAgent(result.text.trim(), ctx);

  fs.unlinkSync('./temp.ogg');
  fs.unlinkSync('./temp.pcm');
});

bot.start();
console.log('Ready.');

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

async function handoffToAgent(message: string, ctx: BotContext) {
  console.log(`\n\nPrompting: "${message}"`);

  if (llmState.working) {
    process.stdout.write(`\n\nSending response to ${ctx.from?.username}...`);
    await ctx.reply('Working on that request...');
    process.stdout.write(`done. ${pc.green('✓')}\n`);
    return;
  }

  llmState.working = true;
  const t = await getOrCreateThread();

  await t.prompt(message, {
    onThinking: (chunk: string) => {}, //process.stdout.write(pc.gray(chunk)),
    onContent: (chunk: string) => {
      process.stdout.write(pc.green(chunk));
      llmState.response += chunk;
    },
    onToolcall: async () => {
      if (llmState.response.trim() !== '') {
        process.stdout.write(
          `\n\nSending partial response to ${ctx.from?.username}...`
        );
        await ctx.reply(llmState.response);
        llmState.response = '';
      }
    },
    onDone: async () => {
      if (llmState.response.trim() !== '') {
        process.stdout.write(
          `\n\nSending response to ${ctx.from?.username}...`
        );
        await ctx.reply(llmState.response);
      }
      llmState.working = false;
      llmState.response = '';
      process.stdout.write(`done. ${pc.green('✓')}\n`);
    },
    onError: async (error: string) => {
      if (error) {
        console.error(pc.red(`Error: ${error}`));
        await ctx.reply(`Error: ${error}`);
      }
      llmState.working = false;
      llmState.response = '';
    },
  });
}
