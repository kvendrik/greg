import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { Agent, type Callbacks } from '../../agent';
import * as storage from './storage/storage';
import { createLogger } from '../../utilities/logger';
import { get as getConfig } from '../../config';

const config = await getConfig();

const logger = createLogger('Sessions Manager');

export type Session = {
  id: string;
  subscribe: typeof Agent.prototype.subscribe;
  abort: typeof Agent.prototype.abort;
  prompt: typeof Agent.prototype.prompt;
  channels: string[];
};

const loadedSessions = new Map<string, Session>();

export function list(): Array<{
  id: string;
  loaded: boolean;
  channels?: string[];
}> {
  return storage.list().map((sessionId) => {
    const loadedSession = loadedSessions.get(sessionId);
    return loadedSession
      ? {
          id: sessionId,
          loaded: true,
          channels: loadedSession.channels,
        }
      : {
          id: sessionId,
          loaded: false,
        };
  });
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

export function get(sessionId: string): Session {
  if (!loadedSessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} not found`);
  }
  return loadedSessions.get(sessionId)!;
}

export async function load(sessionId: string): Promise<Session> {
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

  const tools: Session = {
    id: sessionId,
    subscribe(channelId: string, callbacks: Callbacks) {
      if (!this.channels.includes(channelId)) {
        this.channels.push(channelId);
      }
      return agent.subscribe(channelId, sessionStorage.proxy(callbacks, agent));
    },
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
    channels: [],
  };

  loadedSessions.set(sessionId, tools);

  return tools;
}
