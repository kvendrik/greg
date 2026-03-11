import { Agent, type Callbacks } from '../../agent';
import * as storage from './storage';
import config from '../../.greg';

export type SessionTools = {
  id: string;
  working: boolean;
  listen: typeof Agent.prototype.listen;
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
    listen: (callbacks: Callbacks) =>
      agent.listen(sessionStorage.proxy(callbacks, agent)),
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
  };

  return tools;
}
