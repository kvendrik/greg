import { Bot, type Context } from 'grammy';
import { FileFlavor, hydrateFiles } from '@grammyjs/files';
import { ping, createThread, type Thread } from './agent-sdk';
import { pipeline } from '@xenova/transformers';
import ffmpeg from 'fluent-ffmpeg';
import pc from 'picocolors';
import fs from 'node:fs';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_SENDER_ID = process.env.TELEGRAM_SENDER_ID;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error(
    'Missing TELEGRAM_BOT_TOKEN. Open Telegram, message @BotFather, send /newbot, follow the prompts (name and username ending in _bot); BotFather will reply with your token once (format 123456789:ABCdef...). Set it in .env and restart.'
  );
}

if (!TELEGRAM_SENDER_ID) {
  console.log(
    'No sender ID set (TELEGRAM_SENDER_ID). Starting in observe mode: when a message arrives we will log the sender ID. Set TELEGRAM_SENDER_ID in .env and restart to enable the agent.'
  );

  const bot = new Bot<BotContext>(TELEGRAM_BOT_TOKEN);

  bot.on('message:text', async (ctx) => {
    console.log(
      `Observe: text message from sender_id=${ctx.from?.id} (username: ${ctx.from?.username ?? 'n/a'}). Set TELEGRAM_SENDER_ID=${ctx.from?.id} in .env to allow this user.`
    );
  });

  console.log('Ready in observe mode.');
  await bot.start();

  process.exit(0);
}

if (!(await ping())) {
  console.error('Agent is not running.');
  process.exit(1);
}

type BotContext = FileFlavor<Context>;

const llmState = { working: false, response: '' };
let thread: Thread | null = null;
const bot = new Bot<BotContext>(TELEGRAM_BOT_TOKEN);

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
  if (ctx.from?.id.toString() !== TELEGRAM_SENDER_ID) {
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
  if (ctx.from?.id.toString() !== TELEGRAM_SENDER_ID) {
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

  //await ctx.reply(`📝 ${result.text}`);

  handoffToAgent(result.text.trim(), ctx);

  fs.unlinkSync('./temp.ogg');
  fs.unlinkSync('./temp.pcm');
});

bot.start();
console.log('Ready.');

function oggToRawPcm(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('s16le') // Raw PCM, 16-bit signed little-endian
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

  // Convert Int16 to Float32 (normalize to -1.0 to 1.0)
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  return float32Array;
}

async function handoffToAgent(message: string, ctx: BotContext) {
  console.log(`\n\nPrompting: "${message}"`);

  if (llmState.working) {
    await ctx.reply('Working on that request...');
    return;
  }

  llmState.working = true;
  const t = await getOrCreateThread();

  await t.prompt(message, {
    onThinking: (chunk: string) => process.stdout.write(pc.gray(chunk)),
    onContent: (chunk: string) => {
      process.stdout.write(pc.green(chunk));
      llmState.response += chunk;
    },
    onDone: async () => {
      process.stdout.write(`\n\nSending response to ${ctx.from?.username}...`);
      await ctx.reply(llmState.response);
      llmState.working = false;
      llmState.response = '';
      process.stdout.write(`done. ${pc.green('✓')}\n`);
    },
    onError: async (error: string) => {
      console.error(pc.red(`Error: ${error}`));
      await ctx.reply(`Error: ${error}`);
      llmState.working = false;
      llmState.response = '';
    },
  });
}
