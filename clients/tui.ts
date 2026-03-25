import * as gateway from '../gateway';
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
import { TOOL_GUARD_TEXT_REPLY_HINT } from '../agent/tools/utilities/policy/policy';
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

const { setGetReply, stop } = await gateway.start();
const session = gateway.get('main');

let thinkingStream: ReturnType<typeof createContentStream> | null = null;
let thinkingStreamPromise: Promise<void> | null = null;
let thinkingSpinner: ReturnType<typeof spinner> | null = null;
let thinkingStartTime: DOMHighResTimeStamp | null = null;
let lastAssistantOutput = '';
let assistantSegmentForLog = '';

const config = await getConfig();

function createContentStream(): {
  value: () => string;
  push: (chunk: string) => void;
  end: () => void;
  iterable: AsyncIterable<string>;
} {
  const chunks: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<string>> {
          while (chunks.length === 0 && !done) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          const next = chunks.shift();
          if (next !== undefined) {
            return { value: next, done: false };
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

function clearThinking(): void {
  if (thinkingSpinner) {
    const duration = performance.now() - (thinkingStartTime ?? 0);
    thinkingSpinner.stop(pc.dim(`Thought for ${duration.toFixed(0)}ms`));
    thinkingSpinner = null;
    thinkingStartTime = null;
  }
}

function startThinkingStream(): void {
  if (!thinkingStream) {
    thinkingStream = createContentStream();
    thinkingStreamPromise = stream.info(thinkingStream.iterable);
  }
}

async function flushThinkingStream(): Promise<void> {
  if (thinkingStream) {
    thinkingStream.end();
    thinkingStream = null;
  }
  if (thinkingStreamPromise) {
    await thinkingStreamPromise.catch(() => {});
    thinkingStreamPromise = null;
  }
}

function logAssistantSegmentIfNeeded(): void {
  const segment = assistantSegmentForLog.trim();
  if (segment) {
    log.step(segment);
  }
  assistantSegmentForLog = '';
}

async function flushStream(): Promise<void> {
  await flushThinkingStream();
}

session.subscribe('tui', {
  onTurnStart: () => {
    lastAssistantOutput = '';
    assistantSegmentForLog = '';
    thinkingSpinner = spinner();
    thinkingSpinner.start('🧠 Thinking...');
    thinkingStartTime = performance.now();
  },
  onThinking: (_chunk) => {
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
    assistantSegmentForLog += chunk;
    lastAssistantOutput += chunk;
  },
  onToolcall: (_name, _args) => {
    clearThinking();
    void (async () => {
      await flushThinkingStream();
      logAssistantSegmentIfNeeded();
    })().catch((error: unknown) => {
      log.error(error instanceof Error ? error.message : String(error));
    });
  },
  onTurnDone: () => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    logAssistantSegmentIfNeeded();
  },
  onTurnStop: (): void => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    logAssistantSegmentIfNeeded();
  },
  onError: (error): void => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    assistantSegmentForLog = '';
    if (error) {
      log.error(error);
      process.exit(1);
    }
  },
});

setGetReply(async (question) => {
  clearThinking();
  await flushThinkingStream();

  const message = question.endsWith(TOOL_GUARD_TEXT_REPLY_HINT)
    ? question.slice(0, -TOOL_GUARD_TEXT_REPLY_HINT.length)
    : question;

  const answer = await select({
    message,
    options: [
      { label: 'deny', value: '/deny' },
      { label: 'allow once', value: '/once' },
    ],
    initialValue: '/once',
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

inputLoop().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  shutdown();
});

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown(): void {
  outro('👋 Goodbye!');
  stop();
  process.exit(0);
}

async function inputLoop(): Promise<void> {
  for (;;) {
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

        const voiceId = config.voice?.elevenlabs?.voiceId;
        if (voiceId == null || voiceId === '') {
          throw new Error(
            'ElevenLabs voiceId is not configured (voice.elevenlabs.voiceId)'
          );
        }
        const buffer = await synthesizeToBuffer(lastAssistantOutput, {
          voiceId,
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
      placeholder: `Send a message… (/t to transcribe, /v for voice mode)`,
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
      const eleven = config.voice?.elevenlabs;
      if (!eleven?.key || !eleven.voiceId) {
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
      options: devices.map((device) => ({
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
