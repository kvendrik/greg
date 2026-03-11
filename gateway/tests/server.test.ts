import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { startServer } from '../server';
import WebSocket from 'ws';

let server: Awaited<ReturnType<typeof startServer>>;
let baseUrl: string;
let wsBaseUrl: string;

beforeAll(async () => {
  server = await startServer(0);

  const port = server.port;
  baseUrl = `http://127.0.0.1:${port}`;
  wsBaseUrl = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.stop();
});

describe('server', () => {
  describe('HTTP routes', () => {
    it('GET /ping returns ok', async () => {
      const response = await fetch(`${baseUrl}/ping`);

      expect(response.status).toBe(200);
      const json = (await response.json()) as { status?: string };
      expect(json.status).toBe('ok');
    });

    it('returns 404 for unknown route', async () => {
      const response = await fetch(`${baseUrl}/unknown`);
      expect(response.status).toBe(404);
    });
  });

  describe('WebSocket connections', () => {
    it('returns error and closes when session is missing', async () => {
      const socket = new WebSocket(
        `${wsBaseUrl}/sessions/non-existent-session`
      );

      const messages: unknown[] = [];

      await new Promise<void>((resolve, reject) => {
        socket.on('message', (data) => {
          try {
            const parsed = JSON.parse(
              typeof data === 'string' ? data : data.toString()
            ) as unknown;
            messages.push(parsed);
          } catch (err) {
            reject(err);
          }
        });

        socket.on('close', () => {
          try {
            const hasErrorMessage = messages.some(
              (msg) =>
                typeof msg === 'object' &&
                msg !== null &&
                'type' in msg &&
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (msg as any).type === 'error'
            );
            expect(hasErrorMessage).toBe(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        socket.on('error', (err) => {
          reject(err);
        });
      });
    });
  });
});

