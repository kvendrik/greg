import fs from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';

type TaskRequest = { task: string; data: unknown; [key: string]: unknown };

export class TaskChannel<D> {
  private readonly socketPath: string;
  private pendingMessageConsumer: ((data: D) => void) | null = null;
  private handlers: Record<string, (data: D) => Promise<unknown>> = {};

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /** Register how to send the prompt to the user for the task. */
  onTask(task: string, callback: (data: D) => Promise<unknown>): void {
    this.handlers[task] = callback;
  }

  /** Returns whether the message was consumed by a pending. */
  onIncomingMessage(data: D): { handledByChannel: boolean } {
    if (!this.pendingMessageConsumer) return { handledByChannel: false };
    const consumer = this.pendingMessageConsumer;
    this.pendingMessageConsumer = null;
    consumer(data);
    return { handledByChannel: true };
  }

  /** Start listening on stdin and Unix socket for requests (newline-delimited JSON; not JSON-RPC 2.0). */
  listen(): void {
    this.listenStdin();
    this.listenSocket();
  }

  /** Send an request to a running service; returns the user's reply. */
  static send<D>(task: string, data: D, socketPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const once = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const socket = net.createConnection(socketPath, () => {
        const request = JSON.stringify({ task, data }) + '\n';
        socket.write(request);
      });
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd !== -1) {
          socket.destroy();
          const line = buffer.slice(0, lineEnd).trim();
          try {
            const out = JSON.parse(line) as {
              task?: string;
              reply?: string;
              error?: string;
            };
            if (out.task === task) {
              if (typeof out.error === 'string')
                once(() => reject(new Error(out.error)));
              else if (typeof out.reply === 'string')
                once(() => resolve(out.reply!));
              else
                once(() => reject(new Error(`Unexpected response: ${line}`)));
            } else {
              once(() => reject(new Error(`Unexpected response: ${line}`)));
            }
          } catch {
            once(() => reject(new Error(`Invalid response: ${line}`)));
          }
        }
      });
      socket.on('error', (err) => once(() => reject(err)));
      socket.on('close', () => {
        if (!settled && buffer.indexOf('\n') === -1) {
          once(() =>
            reject(
              new Error('Telegram service closed connection without reply')
            )
          );
        }
      });
    });
  }

  private setPendingMessageConsumer(fn: ((data: D) => void) | null): void {
    this.pendingMessageConsumer = fn;
  }

  private dispatch(
    task: string,
    request: TaskRequest,
    respond: (payload: unknown) => void
  ): void {
    if (request.task === task) {
      this.handleAwaitResponse(task, request, respond);
      return;
    }
    respond({ task: request.task, error: `Unknown task: ${request.task}` });
  }

  private handleAwaitResponse(
    task: string,
    request: TaskRequest,
    respond: (payload: unknown) => void
  ): void {
    const handler = this.handlers[task];

    if (!handler) {
      respond({ task, error: 'No handler registered' });
      return;
    }

    const payload = request.data as D;

    handler(payload)
      .then((result) => {
        const reply =
          typeof result === 'string' ? result : result == null ? '' : undefined;
        if (typeof reply === 'string') {
          respond({ task, reply });
        } else {
          respond({ task, reply: '' });
        }
      })
      .catch((err) => {
        respond({ task, error: String(err) });
      });
  }

  private handleLine(line: string, respond: (payload: unknown) => void): void {
    try {
      const request = JSON.parse(line) as TaskRequest;
      if (typeof request?.task === 'string') {
        this.dispatch(request.task, request, respond);
      }
    } catch {
      // ignore malformed lines
    }
  }

  private listenStdin(): void {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      this.handleLine(line, (payloadOut) => {
        process.stdout.write(JSON.stringify(payloadOut) + '\n');
      });
    });
  }

  private listenSocket(): void {
    if (fs.existsSync(this.socketPath)) fs.rmSync(this.socketPath);
    const server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        this.handleLine(line, (payloadOut) => {
          socket.write(JSON.stringify(payloadOut) + '\n');
          socket.end();
        });
      });
    });

    server.listen(this.socketPath);
  }
}
