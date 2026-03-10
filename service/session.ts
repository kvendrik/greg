import { randomUUID } from 'node:crypto';
import config from '../.greg';
import { Agent, type PromptInput, type Callbacks } from './Agent';
import { createTranscripter } from './transcriber/transcriber';

export type Session = {
  working: boolean;
  listen(callbacks: Callbacks): void;
  abort(): void;
  prompt(input: PromptInput): Promise<void>;
  id: string;
  delete(): void;
};

const sessions = new Map<string, Session>();

export async function create(): Promise<Session> {
  const sessionId = randomUUID();
  const transcripter = createTranscripter(sessionId);

  const agent = await Agent.create(config, {
    addToTranscript: transcripter.add,
  });

  const session: Session = {
    id: sessionId,
    get working() {
      return agent.working;
    },
    listen: (callbacks: Callbacks) => {
      agent.listen(transcripter.proxy(callbacks, agent));
    },
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
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
