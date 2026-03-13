import type { AgentMessage } from '@mariozechner/pi-agent-core';
import path from 'node:path';
import fs from 'node:fs';
import config from '../../../.greg';
import { getWorkspacePath } from '../../../agent/utilities';
import type { Agent, Callbacks } from '../../../agent';
import { createLogger } from '../../../utilities/logger';

const logger = createLogger('Session Storage');

export type StorageSession = {
  messages: AgentMessage[];
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
};

function getSessionsDir(): string {
  const dir = path.join(getWorkspacePath(config), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function list() {
  const sessionsDir = getSessionsDir();
  return fs
    .readdirSync(sessionsDir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace('.jsonl', ''));
}

export function exists(sessionId: string): boolean {
  const sessionPath = path.join(getSessionsDir(), `${sessionId}.jsonl`);
  return fs.existsSync(sessionPath);
}

export function destroy(sessionId: string): void {
  const sessionPath = path.join(getSessionsDir(), `${sessionId}.jsonl`);
  fs.unlinkSync(sessionPath);
}

export async function create(sessionId: string): Promise<StorageSession> {
  const sessionPath = path.join(getSessionsDir(), `${sessionId}.jsonl`);
  fs.writeFileSync(sessionPath, '');
  return load(sessionId);
}

async function parseMessages(
  sessionPath: string,
  {
    maxMessages,
    skipToolResults,
  }: {
    maxMessages?: number;
    skipToolResults?: boolean;
  }
): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];

  for await (const rawLine of tail(sessionPath)) {
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const message = JSON.parse(trimmed) as AgentMessage;

    if (skipToolResults && message.role === 'toolResult') {
      continue;
    }

    messages.push(message);

    if (maxMessages !== undefined && messages.length >= maxMessages) {
      break;
    }
  }

  // We collected from newest to oldest, so reverse to chronological order.
  messages.reverse();
  return messages;
}

export async function load(sessionId: string): Promise<StorageSession> {
  const sessionPath = path.join(getSessionsDir(), `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session ${sessionId} not found`);
  }

  logger.info(
    `Loading session ${sessionId} from ${sessionPath}. Loading last 40 messages and skipping tool results.`
  );
  const messages = await parseMessages(sessionPath, {
    maxMessages: 40,
    skipToolResults: true,
  });

  return {
    messages,
    proxy: (callbacks: Callbacks, agent: Agent): Callbacks => {
      const boundCallbacks = Object.entries(callbacks).reduce(
        (acc, [key, callback]) => ({
          ...acc,
          [key]: callback?.bind(agent),
        }),
        {} as Callbacks
      );

      return {
        ...boundCallbacks,
        onTurnDone: (newMessages?: AgentMessage[]) => {
          if (newMessages && newMessages.length > 0) {
            const jsonl = newMessages.map((m) => JSON.stringify(m)).join('\n');
            const toAppend = jsonl ? '\n' + jsonl : '';

            fs.appendFileSync(sessionPath, toAppend);
          }
          callbacks.onTurnDone?.(newMessages);
        },
      };
    },
  };
}

async function* tail(path: string): AsyncGenerator<string> {
  const file = await fs.promises.open(path, 'r');
  const chunkSize = 64 * 1024;

  try {
    const stat = await file.stat();
    let position = stat.size;
    const buffer = Buffer.alloc(chunkSize);
    let bufferContent = '';

    while (position > 0) {
      const bytesToRead = Math.min(chunkSize, position);
      position -= bytesToRead;

      const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) {
        break;
      }

      const chunk = buffer.toString('utf8', 0, bytesRead);
      bufferContent = chunk + bufferContent;

      // Process complete lines from the end of the buffer so we walk
      // the file from newest to oldest.
      // We keep any partial line at the start in bufferContent.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const newlineIndex = bufferContent.lastIndexOf('\n');
        if (newlineIndex === -1) {
          break;
        }

        const line = bufferContent.slice(newlineIndex + 1);
        bufferContent = bufferContent.slice(0, newlineIndex);

        if (line.length === 0) {
          continue;
        }

        yield line;
      }
    }

    const remaining = bufferContent;
    if (remaining.length > 0) {
      yield remaining;
    }
  } finally {
    await file.close();
  }
}
