import type { AgentMessage } from '@mariozechner/pi-agent-core';
import {
  Agent,
  type Callbacks,
  type AgentConfig,
  type AgentOptions,
} from '../../agent';
import { Storage } from './storage/storage';
import { createLogger } from '../../utilities/logger';
import { get as getConfig } from '../../config';
import { getWorkspacePath } from '../../agent/utilities';

const globalConfig = await getConfig();
const logger = createLogger('Sessions Manager');

export type Session = {
  id: string;
  working: typeof Agent.prototype.working;
  subscribe: typeof Agent.prototype.subscribe;
  unsubscribe: typeof Agent.prototype.unsubscribe;
  abort: typeof Agent.prototype.abort;
  prompt: typeof Agent.prototype.prompt;
};

// {[sessionId: string]: { [resolvedWorkspacePath: string]: Session }}
const loadedSessions = new Map<string, Map<string, Session>>();

export function list(config: AgentConfig = globalConfig): string[] {
  const storage = new Storage(config);
  return storage.list();
}

export function exists(
  sessionId: string,
  config: AgentConfig = globalConfig
): boolean {
  const storage = new Storage(config);
  return storage.exists(sessionId);
}

export function destroy(
  sessionId: string,
  config: AgentConfig = globalConfig
): void {
  const storage = new Storage(config);
  const workspacePath = getWorkspacePath(config);
  const session = loadedSessions.get(workspacePath)?.get(sessionId) ?? null;

  if (session) {
    session.abort();
    loadedSessions.get(workspacePath)?.delete(sessionId);
  }

  storage.destroy(sessionId);
}

export function get(
  sessionId: string,
  config: AgentConfig = globalConfig
): Session {
  const workspacePath = getWorkspacePath(config);
  const session = loadedSessions.get(workspacePath)?.get(sessionId) ?? null;

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  return session;
}

export async function create(
  sessionId: string,
  config: AgentConfig = globalConfig
): Promise<void> {
  const storage = new Storage(config);
  await storage.create(sessionId);
}

export async function load(
  sessionId: string,
  config: AgentConfig = globalConfig,
  options: { getSystemPrompt?: AgentOptions['getSystemPrompt'] } = {}
): Promise<Session> {
  const workspacePath = getWorkspacePath(config);
  const loadedSession =
    loadedSessions.get(workspacePath)?.get(sessionId) ?? null;

  if (loadedSession) {
    return loadedSession;
  }

  const storage = new Storage(config);

  if (!storage.exists(sessionId)) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const sessionStorage = await storage.load(sessionId);

  logger.info(
    `[${sessionId}] Creating agent with ${sessionStorage.messages.length} messages...`
  );

  const agent = await Agent.create({
    config,
    messages: sessionStorage.messages,
    onBackgroundUpdate: () => {},
    async onCompact(newMessages: AgentMessage[]) {
      await storage.replace(sessionId, newMessages);
    },
    getSystemPrompt: options.getSystemPrompt,
  });

  logger.info(`[${sessionId}] Created agent. Session ready.`);

  const session: Session = {
    id: sessionId,
    get working() {
      return agent.working;
    },
    subscribe(channelId: string, callbacks: Callbacks) {
      agent.subscribe(channelId, sessionStorage.proxy(callbacks, agent));
    },
    unsubscribe: agent.unsubscribe.bind(agent),
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
  };

  if (!loadedSessions.has(workspacePath)) {
    loadedSessions.set(workspacePath, new Map());
  }

  loadedSessions.get(workspacePath)!.set(sessionId, session);

  return session;
}
