import type { AgentMessage } from '@mariozechner/pi-agent-core';
import path from 'node:path';
import fs from 'node:fs';
import config from '../../../.greg';
import { getWorkspacePath } from '../../../agent/utilities';
import type { Agent, Callbacks } from '../../../agent';

export type StorageSession = {
  messages: AgentMessage[];
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
};

export const sessionsDir = path.join(getWorkspacePath(config), 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });

export function list() {
  return fs
    .readdirSync(sessionsDir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace('.jsonl', ''));
}

export function exists(sessionId: string): boolean {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  return fs.existsSync(sessionPath);
}

export function destroy(sessionId: string): void {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  fs.unlinkSync(sessionPath);
}

export function create(sessionId: string): StorageSession {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  fs.writeFileSync(sessionPath, '');
  return load(sessionId);
}

function parseMessages(sessionPath: string): AgentMessage[] {
  const content = fs.readFileSync(sessionPath, 'utf-8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AgentMessage);
}

export function load(sessionId: string): StorageSession {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session ${sessionId} not found`);
  }

  return {
    messages: parseMessages(sessionPath),
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
          if (!newMessages) {
            return;
          }
          const jsonl = newMessages.map((m) => JSON.stringify(m)).join('\n');
          const toAppend = jsonl ? '\n' + jsonl : '';
          fs.appendFileSync(sessionPath, toAppend);
          callbacks.onTurnDone?.(newMessages);
        },
      };
    },
  };
}
