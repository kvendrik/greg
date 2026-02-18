import { Bot, type Context } from 'grammy';
import { FileFlavor, hydrateFiles } from '@grammyjs/files';
import { prompt, abort, ping } from './agent-sdk';
import { pipeline } from '@xenova/transformers';
import ffmpeg from 'fluent-ffmpeg';
import pc from 'picocolors';
import fs from 'node:fs';

if (!(await ping())) {
  console.error('Agent is not running.');
  process.exit(1);
}

type BotContext = FileFlavor<Context>;

const llmState = { working: false, response: '' };
const bot = new Bot<BotContext>(process.env.TELEGRAM_BOT_TOKEN!);

bot.api.config.use(hydrateFiles(bot.token));

const transcriber = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-small'
);

bot.on('message:text', async (ctx) => {
  if (ctx.from?.id.toString() !== process.env.TELEGRAM_SENDER_ID) {
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
    const success = await abort();
    await ctx.reply(success ? 'Okay. Stopping.' : 'Failed to stop.');
    return;
  }

  handoffToAgent(message.text, ctx);
});

bot.on('message:voice', async (ctx) => {
  if (ctx.from?.id.toString() !== process.env.TELEGRAM_SENDER_ID) {
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

  prompt(message, {
    onThinking: (chunk) => {
      process.stdout.write(pc.gray(chunk));
    },
    onContent: (chunk) => {
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
  });
}
