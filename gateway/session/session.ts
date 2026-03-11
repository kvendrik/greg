import config from '../../.greg';
import { Agent, type PromptInput, type Callbacks } from '../../agent';
import * as storage from './storage';
import { TaskChannel } from '../../clients/TaskChannel';
import path from 'node:path';

export type SessionTools = {
  id: string;
  working: boolean;
  listen: typeof Agent.prototype.listen;
  abort: typeof Agent.prototype.abort;
  prompt: typeof Agent.prototype.prompt;
  delete(): void;
};

export function list(): string[] {
  return storage.list();
}

export async function create(sessionId: string): Promise<SessionTools> {
  const sessionStorage = storage.exists(sessionId)
    ? storage.load(sessionId)
    : storage.create(sessionId);

  const agent = await Agent.create({
    config,
  });

  const session: Session = {
    id: sessionId,
    working: agent.working,
    listen: (callbacks: Callbacks) =>
      agent.listen(sessionStorage.proxy(callbacks, agent)),
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
    delete() {
      agent.abort();
      storage.delete(sessionId);
    },
  };

  return session;
}

export function exists(sessionId: string): boolean {
  return storage.exists(sessionId);
}

export function delete(sessionId: string): void {
  return storage.delete(sessionId);
}
