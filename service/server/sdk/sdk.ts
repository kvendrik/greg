import config from '../../../.greg';
import type { PromptInput, Callbacks } from '../../Agent/Agent';

function getBase(): string {
  return `http://localhost:${config.port}`;
}

export type { PromptInput, Callbacks };

type WebSocketFactory = (url: string) => WebSocket;

let webSocketFactory: WebSocketFactory = (url) => new WebSocket(url);

export function setWebSocketFactory(factory: WebSocketFactory): void {
  webSocketFactory = factory;
}

export class Session {
  public readonly id: string;

  private destroyed = false;
  private socket: WebSocket | null = null;
  private socketReadyPromise: Promise<WebSocket> | null = null;
  private pendingTurn: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private callbacks: Callbacks = {};

  constructor(id: string) {
    this.id = id;
  }

  listen(callbacks: Callbacks): void {
    this.callbacks = callbacks;
  }

  static agentOnline() {
    return ping();
  }

  private resetSocket(): void {
    this.socket = null;
    this.socketReadyPromise = null;
  }

  private attachSocketListeners(ws: WebSocket): void {
    ws.addEventListener('message', (event) => {
      const { callbacks } = this;
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
      const callbacks = this.callbacks;
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
      const callbacks = this.callbacks;
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

    const url = `ws://localhost:${config.port}/sessions/${this.id}`;

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

    return destroySession(this.id);
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.destroyed) {
      throw new Error('Session has been destroyed');
    }

    if (this.pendingTurn) {
      throw new Error('Session is already handling a prompt');
    }

    const ws = await this.ensureSocket();

    return new Promise<void>((resolve, reject) => {
      this.pendingTurn = { resolve, reject };

      ws.send(
        JSON.stringify({
          type: 'prompt',
          prompt: input,
        })
      );
    });
  }

  static async create(): Promise<Session> {
    const base = getBase();
    const res = await fetch(`${base}/sessions/new`, { method: 'POST' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${text}`);
    }
    const { id } = (await res.json()) as { id: string };
    return new Session(id);
  }
}

async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${getBase()}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

async function destroySession(sessionId: string): Promise<boolean> {
  const res = await fetch(`${getBase()}/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  return res.ok;
}

export const pingAgent = ping;
