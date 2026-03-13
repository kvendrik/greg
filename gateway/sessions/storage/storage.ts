import type { AgentMessage } from '@mariozechner/pi-agent-core';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
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

export async function load(sessionId: string): Promise<StorageSession> {
  const sessionPath = path.join(getSessionsDir(), `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session ${sessionId} not found`);
  }

  let maxMessages = 40;

  logger.info(
    `[${sessionId}] Loading session from ${sessionPath}. Loading last ${maxMessages} messages.`
  );

  const messages = (await tail(sessionPath, maxMessages)).map((l) =>
    JSON.parse(l)
  ) as AgentMessage[];

  logger.info(`[${sessionId}] Loaded ${messages.length} messages.`);

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

async function tail(path: string, lines: number): Promise<string[]> {
  const result = execSync(`tail -n ${lines} ${path}`);
  return result
    .toString()
    .split('\n')
    .map((line) => line);
}
