import type { AgentMessage } from '@mariozechner/pi-agent-core';
import path from 'node:path';
import fs from 'node:fs';
import { getWorkspacePath } from '../../../agent/utilities';
import type { Agent, Callbacks } from '../../../agent';
import type { AgentConfig } from '../../../agent/types';
import { createLogger } from '../../../utilities/logger';

const logger = createLogger('Session Storage');

export interface StorageSession {
  messages: AgentMessage[];
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
}

export class Storage {
  constructor(private readonly config: AgentConfig) {}

  private getSessionsDir(): string {
    const dir = path.join(getWorkspacePath(this.config), 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  list(): string[] {
    const sessionsDir = this.getSessionsDir();
    return fs
      .readdirSync(sessionsDir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => file.replace('.jsonl', ''));
  }

  exists(sessionId: string): boolean {
    const sessionPath = path.join(this.getSessionsDir(), `${sessionId}.jsonl`);
    return fs.existsSync(sessionPath);
  }

  destroy(sessionId: string): void {
    const sessionPath = path.join(this.getSessionsDir(), `${sessionId}.jsonl`);
    fs.unlinkSync(sessionPath);
  }

  replace(sessionId: string, messages: AgentMessage[]): Promise<void> {
    const sessionPath = path.join(this.getSessionsDir(), `${sessionId}.jsonl`);
    fs.writeFileSync(
      sessionPath,
      messages.map((m) => JSON.stringify(m)).join('\n')
    );
    return Promise.resolve();
  }

  create(sessionId: string): Promise<StorageSession> {
    const sessionPath = path.join(this.getSessionsDir(), `${sessionId}.jsonl`);
    fs.writeFileSync(sessionPath, '');
    return this.load(sessionId);
  }

  load(sessionId: string): Promise<StorageSession> {
    const sessionPath = path.join(this.getSessionsDir(), `${sessionId}.jsonl`);

    if (!fs.existsSync(sessionPath)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    logger.info(`[${sessionId}] Loading session from ${sessionPath}`);

    const messages = fs
      .readFileSync(sessionPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((line): AgentMessage => {
        const raw: unknown = JSON.parse(line);
        return raw as AgentMessage;
      });

    logger.info(`[${sessionId}] Loaded ${messages.length} messages.`);

    return Promise.resolve({
      messages,
      proxy: (callbacks: Callbacks, agent: Agent): Callbacks => {
        const boundCallbacks = Object.entries(callbacks).reduce<Callbacks>(
          (acc, [key, callback]) => ({
            ...acc,
            [key]: callback.bind(agent),
          }),
          {}
        );

        return {
          ...boundCallbacks,
          onTurnDone: (newMessages?: AgentMessage[]) => {
            if (newMessages && newMessages.length > 0) {
              const jsonl = newMessages
                .map((m) => JSON.stringify(m))
                .join('\n');
              const toAppend = jsonl ? '\n' + jsonl : '';

              fs.appendFileSync(sessionPath, toAppend);
            }
            callbacks.onTurnDone?.(newMessages);
          },
        };
      },
    });
  }
}
