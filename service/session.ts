import { createUUID } from './utilities';
import config from '../.greg';
import { Agent, type PromptInput, type Callbacks } from './Agent';
import { createTranscripter } from './transcriber/transcriber';
import { TaskChannel } from '../clients/TaskChannel';
import path from 'node:path';

export type Session = {
  working: boolean;
  listen(id: string, callbacks: Callbacks): void;
  abort(): void;
  prompt(input: PromptInput): Promise<void>;
  id: string;
  delete(): void;
};

export const sessions = new Map<string, Session>();

export function listIds(): string[] {
  return Array.from(sessions.keys());
}

export async function create(idSuffix: string): Promise<Session> {
  const baseId = createUUID();
  const sessionId =
    idSuffix && idSuffix.trim() !== '' ? `${baseId}-${idSuffix}` : baseId;
  const transcripter = createTranscripter(sessionId);

  const agent = await Agent.create({
    config,
    addToTranscript: transcripter.add,
  });

  const session: Session = {
    id: sessionId,
    working: agent.working,
    listen: (id: string, callbacks: Callbacks) =>
      agent.listen(id, transcripter.proxy(callbacks, agent)),
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

if (process.env.DEBUG) {
  /**
   * Task channel to allow the `greg` CLI to force an Agent to client
   * update through `greg session update <sessionId> <prompt>`
   */
  const socketPath = path.join(__dirname, '.cli-socket.sock');
  const taskChannel = new TaskChannel<{ sessionId: string; text: string }>(
    socketPath
  );

  taskChannel.onTask('force-update', async ({ sessionId, text }) => {
    if (!sessions.has(sessionId)) {
      console.error(
        `Attempted force-update() but session "${sessionId}" not found`
      );
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.prompt({ content: text, images: [] });
  });

  taskChannel.listen();
}
