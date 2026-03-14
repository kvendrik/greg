import config from '../../.greg';
import type { PromptInput, Callbacks } from '../../agent';
import { createUUID } from '../sessions/utilities';

let overrideBaseUrl: string | null = null;

export function setBaseUrlForTests(url: string | null): void {
  overrideBaseUrl = url;
}

function getBase(): string {
  if (overrideBaseUrl) return overrideBaseUrl;
  return `http://localhost:${config.port}`;
}

export type { PromptInput, Callbacks };

type WebSocketFactory = (url: string) => WebSocket;

let webSocketFactory: WebSocketFactory = (url) => new WebSocket(url);

export function setWebSocketFactory(factory: WebSocketFactory): void {
  webSocketFactory = factory;
}

export class Session {
  private destroyed = false;
  private socket: WebSocket | null = null;
  private socketReadyPromise: Promise<WebSocket> | null = null;
  private pendingTurn: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private callbacks: Map<string, Callbacks> = new Map();

  private constructor(
    private readonly sessionId: string,
    private readonly channelId: string
  ) {}

  async connect(): Promise<void> {
    await this.ensureSocket();
  }

  subscribe(callbacks: Callbacks): string {
    const id = createUUID();
    this.callbacks.set(id, callbacks);
    return id;
  }

  private resetSocket(): void {
    this.socket = null;
    this.socketReadyPromise = null;
  }

  private getCallbacks(): Callbacks {
    const callbacks = Array.from(this.callbacks.values());
    return {
      onTurnStart: (prompt: PromptInput) => {
        callbacks.forEach((callback) => callback.onTurnStart?.(prompt));
      },
      onContent: (chunk: string) => {
        callbacks.forEach((callback) => callback.onContent?.(chunk));
      },
      onThinking: (chunk: string) => {
        callbacks.forEach((callback) => callback.onThinking?.(chunk));
      },
      onToolcall: (name: string, args: Record<string, unknown>) => {
        callbacks.forEach((callback) => callback.onToolcall?.(name, args));
      },
      onTurnDone: () => {
        callbacks.forEach((callback) => callback.onTurnDone?.());
      },
      onTurnStop: () => {
        callbacks.forEach((callback) => callback.onTurnStop?.());
      },
      onError: (error: string) => {
        callbacks.forEach((callback) => callback.onError?.(error));
      },
    };
  }

  private attachSocketListeners(ws: WebSocket): void {
    ws.addEventListener('message', (event) => {
      const callbacks = this.getCallbacks();

      try {
        const data = JSON.parse(String(event.data)) as {
          type: string;
          chunk?: string;
          name?: string;
          args?: string;
          error?: string;
          prompt?: PromptInput;
        };

        switch (data.type) {
          case 'turn_start':
            if (data.prompt) {
              callbacks.onTurnStart?.(data.prompt);
            }
            break;
          case 'content':
            callbacks.onContent?.(data.chunk ?? '');
            break;
          case 'thinking':
            callbacks.onThinking?.(data.chunk ?? '');
            break;
          case 'toolcall':
            callbacks.onToolcall?.(
              data.name ?? '',
              data.args
                ? (JSON.parse(data.args) as Record<string, unknown>)
                : {}
            );
            break;
          case 'done':
            callbacks.onTurnDone?.();
            if (this.pendingTurn) {
              this.pendingTurn.resolve();
              this.pendingTurn = null;
            }
            break;
          case 'stopped':
            callbacks.onTurnStop?.();
            if (this.pendingTurn) {
              this.pendingTurn.resolve();
              this.pendingTurn = null;
            }
            break;
          case 'error':
            callbacks.onError?.(data.error ?? 'Unknown error');
            break;
          default:
            break;
        }
      } catch {
        // ignore malformed messages, do not crash the stream
      }
    });

    ws.addEventListener('error', (event) => {
      const callbacks = this.getCallbacks();
      if (this.pendingTurn) {
        const message =
          event instanceof ErrorEvent
            ? event.message
            : 'WebSocket error occurred';
        callbacks.onError?.(message);
        this.pendingTurn.reject(new Error(message));
        this.pendingTurn = null;
      }
      this.resetSocket();
    });

    ws.addEventListener('close', () => {
      const callbacks = this.getCallbacks();
      if (this.pendingTurn) {
        const message = 'Connection closed';
        callbacks.onError?.(message);
        this.pendingTurn.reject(new Error(message));
        this.pendingTurn = null;
      }
      this.resetSocket();
    });
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.socketReadyPromise) {
      return this.socketReadyPromise;
    }

    const url = `ws://localhost:${config.port}/sessions/${this.sessionId}?channelId=${this.channelId}`;

    this.socketReadyPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = webSocketFactory(url);

      ws.addEventListener('open', () => {
        this.socket = ws;
        this.attachSocketListeners(ws);
        resolve(ws);
      });

      ws.addEventListener('error', (event) => {
        const message =
          event instanceof ErrorEvent
            ? event.message
            : 'WebSocket connection failed';
        if (!this.socket || this.socket === ws) {
          this.resetSocket();
        }
        reject(new Error(message));
      });
    });

    return this.socketReadyPromise;
  }

  async destroy(): Promise<boolean> {
    if (this.destroyed) return true;
    this.destroyed = true;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.close();
      } catch {
        // ignore close errors
      }
    }
    this.resetSocket();

    const res = await fetch(`${getBase()}/sessions/${this.sessionId}`, {
      method: 'DELETE',
    });

    return res.ok;
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.destroyed) {
      throw new Error('Session has been destroyed');
    }

    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        throw new Error('Session is not connected');
      }

      this.socket.send(
        JSON.stringify({
          type: 'prompt',
          prompt: input,
        })
      );
    });
  }

  static async create(sessionId: string, channelId: string): Promise<Session> {
    const base = getBase();

    const response = await fetch(`${base}/sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create session: ${response.status} ${text}`);
    }

    return new Session(sessionId, channelId);
  }

  static async existing(
    sessionId: string,
    channelId: string
  ): Promise<Session> {
    const sessions = await listSessions();

    if (!sessions.includes(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return new Session(sessionId, channelId);
  }
}

export async function ping() {
  try {
    const res = await fetch(`${getBase()}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listSessions() {
  if (!(await ping())) {
    throw new Error('Agent is not online');
  }

  const response = await fetch(`${getBase()}/sessions`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sessions: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    sessions?: string[];
  };

  if (!data.sessions) {
    throw new Error('Failed to fetch sessions: invalid response');
  }

  return data.sessions;
}
