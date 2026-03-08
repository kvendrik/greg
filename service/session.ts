import { randomUUID } from 'node:crypto';
import config from '../.greg';
import { Agent, type PromptInput, type PromptOptions } from './Agent';

export type Session = {
  working: boolean;
  abort(): void;
  prompt(input: PromptInput, options: PromptOptions): Promise<void>;
  id: string;
  delete(): void;
};

const sessions = new Map<string, Session>();

export async function create(): Promise<Session> {
  const agent = await Agent.create(config);

  const session: Session = {
    get working() {
      return agent.working;
    },
    abort: () => agent.abort(),
    prompt: (input, opts) => agent.prompt(input, opts),
    id: randomUUID(),
    delete() {
      agent.abort();
      sessions.delete(session.id);
    },
  };
  sessions.set(session.id, session);
  return session;
}

export function get(id: string): Session | null {
  return sessions.get(id) ?? null;
}
