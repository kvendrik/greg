import * as gateway from '../gateway';
import { start } from '../gateway';
import {
  intro,
  outro,
  text,
  spinner,
  stream,
  log,
  select,
  isCancel,
} from '@clack/prompts';
import pc from 'picocolors';
import { get as getConfig } from '../config';
import {
  realtimeTranscribeFromMic,
  listAvFoundationDevices,
} from '../voice/av';
import { synthesizeToBuffer, play } from '../voice/speech';

process.env.GREG_LOG = 'silent';

const initialPrompt =
  process.argv[2]?.trim() === '' ? null : process.argv[2]?.trim();

let voiceMode = Boolean(process.env.VOICE_MODE);
let avDeviceIndex: number | null = null;

const { setGetReply, stop } = await start();
const session = gateway.get('main');

let thinkingStream: ReturnType<typeof createContentStream> | null = null;
let thinkingStreamPromise: Promise<void> | null = null;
let contentStream: ReturnType<typeof createContentStream> | null = null;
let streamPromise: Promise<void> | null = null;
let thinkingSpinner: ReturnType<typeof spinner> | null = null;
let lastAssistantOutput = '';

let toolSpinner: ReturnType<typeof spinner> | null = null;
let lastToolCall: string | null = null;

const config = await getConfig();

function createContentStream() {
  const chunks: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (chunks.length === 0 && !done) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          if (chunks.length > 0) {
            return { value: chunks.shift()!, done: false };
          }
          return { value: '', done: true };
        },
      };
    },
  };

  return {
    value: () => chunks.join(''),
    push(chunk: string) {
      chunks.push(chunk);
      resolve?.();
    },
    end() {
      done = true;
      resolve?.();
    },
    iterable,
  };
}

function clearThinking() {
  if (thinkingSpinner) {
    thinkingSpinner.clear();
    thinkingSpinner = null;
  }

  if (toolSpinner) {
    toolSpinner.stop(pc.dim(`🔧 Called ${lastToolCall}`));
    toolSpinner = null;
  }
}

function startThinkingStream() {
  if (!thinkingStream) {
    thinkingStream = createContentStream();
    thinkingStreamPromise = stream.info(thinkingStream.iterable);
  }
}

async function flushThinkingStream() {
  if (thinkingStream) {
    thinkingStream.end();
    thinkingStream = null;
  }
  if (thinkingStreamPromise) {
    await thinkingStreamPromise.catch(() => {});
    thinkingStreamPromise = null;
  }
}

function startContentStream() {
  if (!contentStream) {
    contentStream = createContentStream();
    streamPromise = stream.step(contentStream.iterable);
  }
}

async function flushStream() {
  await flushThinkingStream();
  if (contentStream) {
    contentStream.end();
    contentStream = null;
  }
  if (streamPromise) {
    await streamPromise.catch(() => {});
    streamPromise = null;
  }
}

session.subscribe('tui', {
  onTurnStart: () => {
    thinkingSpinner = spinner();
    thinkingSpinner.start('🧠 Thinking...');
  },
  onThinking: (chunk) => {
    clearThinking();
    startThinkingStream();
    //thinkingStream!.push(pc.dim(chunk));
  },
  onContent: (chunk) => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    startContentStream();
    contentStream!.push(chunk);
    lastAssistantOutput += chunk;
  },
  onToolcall: async (name, args) => {
    clearThinking();
    await flushStream();
    //log.info(pc.dim(`🔧 [${name}](${JSON.stringify(args)})`));
    toolSpinner = spinner();
    lastToolCall = name;
    toolSpinner.start(`🔧 Calling ${name}...`);
  },
  onTurnDone: async () => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    if (contentStream) {
      contentStream.end();
      contentStream = null;
    }
  },
  onTurnStop: () => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    if (contentStream) {
      contentStream.end();
      contentStream = null;
    }
  },
  onError: (error) => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    if (contentStream) {
      contentStream.end();
      contentStream = null;
    }
    if (error) {
      log.error(error);
      process.exit(1);
    }
  },
});

setGetReply(async (question) => {
  const answer = await text({
    message: question,
    placeholder: '/deny <reason> or /once',
  });
  if (isCancel(answer)) {
    process.exit(0);
  }
  return answer;
});

intro('🤖 Greg');

if (initialPrompt) {
  await session.prompt(
    { content: `${initialPrompt}\n\n[Message was sent from TUI]`, images: [] },
    { channelId: 'tui' }
  );

  await flushStream();
}

inputLoop().catch((error) => {
  log.error(String(error));
  shutdown();
});

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  outro('👋 Goodbye!');
  stop();
  process.exit(0);
}

async function inputLoop() {
  while (true) {
    if (voiceMode) {
      const transcript = await handleVoiceInput();
      if (!transcript) continue;
      const message = transcript;

      lastAssistantOutput = '';

      await session.prompt(
        {
          content: `[User is in voice mode. Ensure replies are voice friendly.]\n\n${message}\n\n[Message was sent from TUI]`,
          images: [],
        },
        { channelId: 'tui' }
      );

      if (lastAssistantOutput.trim()) {
        const speechSpinner = spinner();
        speechSpinner.start('🔉 Playing...');

        const buffer = await synthesizeToBuffer(lastAssistantOutput, {
          voiceId: config.voice?.elevenlabs?.voiceId!,
          useV3: false,
        });

        await play(buffer);
        speechSpinner.clear();
      }

      await flushStream();
      continue;
    }

    const input = await text({
      message: 'You',
      placeholder: 'Send a message… (/t to transcribe, /v for voice mode)',
      validate: (value) => {
        if (!value?.trim()) return 'Message cannot be empty';
        return undefined;
      },
    });

    if (isCancel(input)) {
      process.exit(0);
    }

    if (!input.trim()) continue;

    let message = input.trim();

    if (message === '/t') {
      if (!config.voice?.elevenlabs?.key) {
        log.warn(
          'Voice not configured — set voice.elevenlabs.key in your config.'
        );
        continue;
      }

      const transcript = await handleVoiceInput();
      if (!transcript) continue;
      message = transcript;
    }

    if (message === '/v') {
      if (
        !config.voice?.elevenlabs?.key ||
        !config.voice?.elevenlabs?.voiceId
      ) {
        log.warn(
          'Voice not configured — set voice.elevenlabs.key and voice.elevenlabs.voiceId in your config.'
        );
        continue;
      }

      voiceMode = true;
      log.info('🎙️ Voice mode enabled.');
      continue;
    }

    await session.prompt(
      { content: `${message}\n\n[Message was sent from TUI]`, images: [] },
      { channelId: 'tui' }
    );

    await flushStream();
  }

  shutdown();
}

async function handleVoiceInput(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    log.warn('Voice input is only supported on macOS.');
    return null;
  }

  const config = await getConfig();
  const apiKey = config.voice?.elevenlabs?.key;

  if (!apiKey) {
    log.warn('Voice not configured — set voice.elevenlabs.key in your config.');
    return null;
  }

  const devices = await listAvFoundationDevices();

  if (!devices?.length) {
    log.warn('No microphone found. Is ffmpeg installed? Run `which ffmpeg`');
    return null;
  }

  if (!avDeviceIndex) {
    const device = await select({
      message: 'Select a microphone',
      options: devices?.map((device) => ({
        label: device.name,
        value: device.index,
      })),
    });

    if (isCancel(device)) {
      return null;
    }

    avDeviceIndex = device;
  }

  const voiceSpinner = spinner();
  voiceSpinner.start('🎙 Listening… press Enter to stop');

  const transcript = await realtimeTranscribeFromMic(avDeviceIndex, {
    apiKey,
    onPartial: (text) => {
      if (text.trim()) voiceSpinner.message(`🎙 ${text}`);
    },
  });

  if (transcript) {
    voiceSpinner.stop(`🎙 ${transcript}`);
  } else {
    voiceSpinner.stop('🎙 No speech detected');
  }

  return transcript;
}
