import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { Agent, type Callbacks } from '../../agent';
import * as storage from './storage/storage';
import { createLogger } from '../../utilities/logger';
import config from '../../.greg';

const logger = createLogger('Sessions Manager');

export type SessionTools = {
  id: string;
  subscribe: typeof Agent.prototype.subscribe;
  abort: typeof Agent.prototype.abort;
  prompt: typeof Agent.prototype.prompt;
};

const loadedSessions = new Map<string, SessionTools>();

export function list() {
  return storage.list();
}

export function exists(sessionId: string): boolean {
  return storage.exists(sessionId);
}

export function destroy(sessionId: string): void {
  if (loadedSessions.has(sessionId)) {
    const session = loadedSessions.get(sessionId)!;
    session.abort();
    loadedSessions.delete(sessionId);
  }
  return storage.destroy(sessionId);
}

export async function load(sessionId: string): Promise<SessionTools> {
  if (loadedSessions.has(sessionId)) {
    return loadedSessions.get(sessionId)!;
  }

  const sessionStorage = await (storage.exists(sessionId)
    ? storage.load(sessionId)
    : storage.create(sessionId));

  logger.info(
    `[${sessionId}] Creating agent with ${sessionStorage.messages.length} messages...`
  );

  const agent = await Agent.create({
    config,
    messages: sessionStorage.messages,
    async onCompact(newMessages: AgentMessage[]) {
      await storage.replace(sessionId, newMessages);
    },
  });

  logger.info(`[${sessionId}] Created agent. Session ready.`);

  const tools: SessionTools = {
    id: sessionId,
    subscribe: (channelId: string, callbacks: Callbacks) =>
      agent.subscribe(channelId, sessionStorage.proxy(callbacks, agent)),
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
  };

  loadedSessions.set(sessionId, tools);

  return tools;
}
