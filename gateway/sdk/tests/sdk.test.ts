import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { startServer } from '../../server';
import {
  ping,
  Session,
  setBaseUrlForTests,
  setWebSocketFactory,
  type Callbacks,
  type PromptInput,
} from '../sdk';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  // Start the gateway server on a dynamic port so tests don't depend on
  // the global .greg port, then point the SDK at that URL explicitly.
  server = await startServer(0);
  setBaseUrlForTests(`http://127.0.0.1:${server.port}`);
});

afterAll(() => {
  server.stop();
  setBaseUrlForTests(null);
});

describe('agent SDK', () => {
  describe('ping()', () => {
    it('returns true when server is reachable', async () => {
      const result = await ping();
      expect(result).toBe(true);
    });
  });

  describe('createSession()', () => {
    it('creates and destroys a session', async () => {
      const session = await Session.create('test');
      expect(session.id).toBeTruthy();
      const destroyed = await session.destroy();
      expect(destroyed).toBe(true);
    });
  });

  describe('prompt()', () => {
    it('can be called without prompting the real model', async () => {
      type Listener = (event: { data?: unknown }) => void;

      class FakeWebSocket {
        public readonly url: string;
        public readyState = 1; // OPEN
        private listeners: Record<string, Listener[]> = {
          open: [],
          message: [],
          error: [],
          close: [],
        };

        constructor(url: string) {
          this.url = url;
        }

        addEventListener(type: string, listener: Listener) {
          if (!this.listeners[type]) {
            this.listeners[type] = [];
          }
          this.listeners[type].push(listener);
          if (type === 'open') {
            listener({} as { data?: unknown });
          }
        }

        send(_data: string) {
          // Simulate a full turn lifecycle without talking to the real model
          const turnStartEvent = {
            data: JSON.stringify({
              type: 'turn_start',
              prompt: {
                content: 'Hi',
                images: [] satisfies PromptInput['images'],
              },
            }),
          };
          const doneEvent = {
            data: JSON.stringify({ type: 'done' }),
          };

          this.listeners.message?.forEach((listener) =>
            listener(turnStartEvent)
          );
          this.listeners.message?.forEach((listener) => listener(doneEvent));
        }

        close() {
          const closeEvent = {};
          this.listeners.close?.forEach((listener) =>
            listener(closeEvent as { data?: unknown })
          );
        }
      }

      setWebSocketFactory(
        (url) => new FakeWebSocket(url) as unknown as WebSocket
      );

      try {
        const session = await Session.create('test');
        await session.connect();

        let startCalled = false;
        let doneCalled = false;

        const callbacks: Callbacks = {
          onTurnStart(prompt) {
            startCalled = prompt.content === 'Hi';
          },
          onThinking() {},
          onContent() {},
          onToolcall() {},
          onTurnDone() {
            doneCalled = true;
          },
          onTurnStop() {},
          onError() {},
        };

        session.listen(callbacks);

        const prompt: PromptInput = { content: 'Hi', images: [] };
        await session.prompt(prompt);

        expect(startCalled).toBe(true);
        expect(doneCalled).toBe(true);

        await session.destroy();
      } finally {
        // Restore default factory
        setWebSocketFactory((url) => new WebSocket(url));
      }
    });
  });
});
