import * as sessions from '../sessions';
import type { Callbacks, PromptInput } from '../../agent';

export async function ping(): Promise<boolean> {
  try {
    await sessions.load('main');
    return true;
  } catch {
    return false;
  }
}

export class Session {
  private readonly sessionId: string;

  private constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  static async create(sessionId: string, _clientId: string): Promise<Session> {
    return new Session(sessionId);
  }

  async connect(): Promise<void> {
    await sessions.load(this.sessionId);
  }

  subscribe(callbacks: Callbacks): void {
    // This SDK is only used by the voice CLI in this repo.
    // It currently relies on in-process sessions rather than a remote transport.
    // The voice CLI only uses onThinking/onContent/onToolcall/onTurnDone/onTurnStop/onError.
    const session = sessions.get(this.sessionId);
    session.subscribe('voice-cli', callbacks);
  }

  async prompt(input: PromptInput): Promise<void> {
    const session = sessions.get(this.sessionId);
    await session.prompt(input, { channelId: 'voice-cli' });
  }

  async destroy(): Promise<void> {
    // Best-effort: abort the agent run, but do not delete persisted session data.
    const session = sessions.get(this.sessionId);
    session.abort();
  }
}

