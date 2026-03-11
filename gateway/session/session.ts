import config from '../../.greg';
import { Agent, type PromptInput, type Callbacks } from '../../agent';
import { createTranscripter } from './storage';
import { TaskChannel } from '../../clients/TaskChannel';
import path from 'node:path';

export type Session = {
  id: string;
  working: boolean;
  listen: typeof Agent.prototype.listen;
  abort: typeof Agent.prototype.abort;
  prompt: typeof Agent.prototype.prompt;
  delete(): void;
};

export function list(): string[] {
  return Array.from(sessions.keys());
}

export async function create(sessionId: string): Promise<Session> {
  const transcripter = createTranscripter(sessionId);

  const agent = await Agent.create({
    config,
  });

  const session: Session = {
    id: sessionId,
    working: agent.working,
    listen: (callbacks: Callbacks) =>
      agent.listen(transcripter.proxy(callbacks, agent)),
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
    delete() {
      agent.abort();
      sessions.delete(sessionId);
    },
  };

  sessions.set(sessionId, session);
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
