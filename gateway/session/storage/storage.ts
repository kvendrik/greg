import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolResultMessage,
  Usage,
} from '@mariozechner/pi-ai';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import config from '../../../.greg';
import { getWorkspacePath } from '../../../agent/utilities';
import type { Agent, PromptInput, Callbacks } from '../../../agent';

export type StorageSession = {
  messages: AgentMessage[];
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
};

const sessionsDir = path.join(getWorkspacePath(config), 'sessions');
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

export function delete(sessionId: string): void {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  fs.unlinkSync(sessionPath);
}

export function create(sessionId: string): StorageSession {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  fs.writeFileSync(sessionPath, '');
  return load(sessionId);
}

export function load(sessionId: string): StorageSession {
  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session ${sessionId} not found`);
  }

  return {
    messages: [],
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
        onTurnDone: (messages?: AgentMessage[]) => {
          if (!messages) {
            return;
          }
          const jsonl = messages.map((m) => JSON.stringify(m)).join('\n');
          fs.writeFileSync(sessionPath, jsonl);
          callbacks.onTurnDone?.(messages);
        },
      };
    },
  };
}
