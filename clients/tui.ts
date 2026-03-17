import * as gateway from '../gateway';
import { start } from '../gateway';
import {
  intro,
  outro,
  text,
  spinner,
  stream,
  log,
  isCancel,
} from '@clack/prompts';
import pc from 'picocolors';

const { setGetReply, stop } = await start();
const session = gateway.get('main');

let thinkingStream: ReturnType<typeof createContentStream> | null = null;
let thinkingStreamPromise: Promise<void> | null = null;
let contentStream: ReturnType<typeof createContentStream> | null = null;
let streamPromise: Promise<void> | null = null;
let thinkingSpinner: ReturnType<typeof spinner> | null = null;

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
    thinkingStream!.push(pc.dim(chunk));
  },
  onContent: (chunk) => {
    clearThinking();
    if (thinkingStream) {
      thinkingStream.end();
      thinkingStream = null;
    }
    startContentStream();
    contentStream!.push(chunk);
  },
  onToolcall: async (name, args) => {
    clearThinking();
    await flushStream();
    log.info(pc.dim(`🔧 [${name}](${JSON.stringify(args)})`));
    thinkingSpinner = spinner();
    thinkingSpinner.start('Working...');
  },
  onTurnDone: () => {
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
    if (error) log.error(error);
  },
});

setGetReply(async (question) => {
  const answer = await text({ message: question });
  if (isCancel(answer)) return '';
  return answer;
});

intro('🤖 Greg');

inputLoop().catch((error) => {
  log.error(String(error));
  shutdown();
});

async function inputLoop() {
  while (true) {
    const input = await text({
      message: 'You',
      placeholder: 'Send a message...',
      validate: (value) => {
        if (!value?.trim()) return 'Message cannot be empty';
        return undefined;
      },
    });

    if (isCancel(input)) break;
    if (!input.trim()) continue;

    await session.prompt(
      { content: `${input.trim()}\n\n[Message was sent from TUI]`, images: [] },
      { channelId: 'tui' }
    );

    await flushStream();
  }

  shutdown();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  outro('👋 Goodbye!');
  stop();
  process.exit(0);
}
