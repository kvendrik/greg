import { Agent, type Callbacks, type PromptInput } from '../../agent';
import * as storage from './storage/storage';
import config from '../../.greg';
import type { PromptOptionsRef } from './storage/storage';

export type SessionPromptOptions = { heartbeatAckMaxChars?: number };

export type SessionTools = {
  id: string;
  working: boolean;
  subscribe: typeof Agent.prototype.subscribe;
  abort: typeof Agent.prototype.abort;
  prompt: (input: PromptInput, options?: SessionPromptOptions) => Promise<void>;
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

  const sessionStorage = storage.exists(sessionId)
    ? storage.load(sessionId)
    : storage.create(sessionId);

  const agent = await Agent.create({
    config,
    messages: sessionStorage.messages,
  });

  const tools: SessionTools = {
    id: sessionId,
    working: agent.working,
    subscribe: (callbacks: Callbacks) =>
      agent.subscribe(sessionStorage.proxy(callbacks, agent)),
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
  };

  return tools;
}
