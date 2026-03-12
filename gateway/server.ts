import { serve, type Server, type ServerWebSocket } from 'bun';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import pc from 'picocolors';
import config from '../.greg';
import type { PromptInput } from '../agent';
import { createSender, parsePromptBody } from './utilities';
import * as sessions from './sessions';
import { createLogger } from '../utilities/logger';

const logger = createLogger('GW');

type SessionWebSocketMessage =
  | { type: 'prompt'; prompt: PromptInput }
  | { type: 'abort' }
  | { type: 'delete' };

type AgentEvent =
  | { type: 'turn_start'; prompt: PromptInput }
  | { type: 'content'; chunk: string }
  | { type: 'thinking'; chunk: string }
  | { type: 'toolcall'; name: string; args: string }
  | { type: 'done' }
  | { type: 'stopped' }
  | { type: 'deleted' }
  | { type: 'error'; error: string };

type WebSocketData = {
  sessionId: string;
};

type SessionIdParams = { params: { id: string } };

let server: Server<WebSocketData> | null = null;
const activeSessionIds = new Set<string>();

export async function startServer(port = Number(config.port)) {
  if (server) {
    return server;
  }

  server = serve<WebSocketData>({
    port,
    routes: {
      '/ping': {
        GET: (req: Request) => {
          logRequest(req);
          return Response.json({ status: 'ok' });
        },
      },
      '/sessions': {
        GET: (req: Request) => {
          logRequest(req);
          return Response.json({
            sessions: sessions.list(),
            activeSessions: Array.from(activeSessionIds),
          });
        },
      },
      '/sessions/new': {
        POST: async (req: Request) => {
          logRequest(req);
          let clientId: string | undefined;
          try {
            const bodyText = await req.text();
            if (bodyText) {
              const parsed = JSON.parse(bodyText) as { clientId?: unknown };
              if (
                typeof parsed.clientId === 'string' &&
                parsed.clientId.trim() !== ''
              ) {
                clientId = parsed.clientId;
              }
            }
          } catch {
            // ignore malformed body, fall back to random ID
          }

          const newSession = await sessions.load(
            sessions.createUUID() + (clientId ? `-${clientId}` : '')
          );

          return new Response(JSON.stringify({ id: newSession.id }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
      '/sessions/:id': {
        GET: (
          req: Request & SessionIdParams,
          bunServer: Server<WebSocketData>
        ) => {
          logRequest(req);
          const { id } = req.params;
          if (!id) {
            return new Response('Not found', { status: 404 });
          }
          const success = bunServer.upgrade(req, {
            data: { sessionId: id },
          });
          if (success) {
            return undefined;
          }
          return new Response('WebSocket upgrade failed', { status: 500 });
        },
        DELETE: (req: Request & SessionIdParams) => {
          logRequest(req);
          const { id } = req.params;
          if (!id) {
            return new Response('Not found', { status: 404 });
          }
          if (sessions.exists(id)) {
            sessions.destroy(id);
          }
          return new Response(null, { status: 204 });
        },
      },
      '/*': (req: Request) => {
        logRequest(req);
        return new Response('Not found', { status: 404 });
      },
    },
    fetch(req) {
      return new Response('Not found', { status: 404 });
    },
    websocket: {
      data: {} as WebSocketData,
      async open(ws) {
        const { sessionId } = ws.data;
        activeSessionIds.add(sessionId);

        if (!sessions.exists(sessionId)) {
          createSender<AgentEvent>(ws).send({
            type: 'error',
            error: 'Session not found',
          });
          ws.close(1008, 'Session not found');
          return;
        }

        const existingSession = await sessions.load(sessionId);
        const sender = createSender<AgentEvent>(ws);

        existingSession.subscribe({
          onTurnStart(prompt) {
            sender.send({ type: 'turn_start', prompt });
          },
          onContent(chunk) {
            sender.send({ type: 'content', chunk });
          },
          onThinking(chunk) {
            sender.send({ type: 'thinking', chunk });
          },
          onToolcall(name, args) {
            sender.send({
              type: 'toolcall',
              name,
              args: JSON.stringify(args),
            });
          },
          onTurnDone() {
            sender.send({ type: 'done' });
          },
          onTurnStop() {
            sender.send({ type: 'stopped' });
          },
          onError(err) {
            sender.send({ type: 'error', error: err });
          },
        });
      },
      async message(ws: ServerWebSocket<WebSocketData>, rawMessage) {
        const { sessionId } = ws.data;

        if (!sessions.exists(sessionId)) {
          createSender<AgentEvent>(ws).send({
            type: 'error',
            error: 'Session not found',
          });
          ws.close(1008, 'Session not found');
          return;
        }

        const sender = createSender<AgentEvent>(ws);

        const text =
          typeof rawMessage === 'string'
            ? rawMessage
            : new TextDecoder().decode(
                rawMessage as ArrayBuffer | ArrayBufferView
              );

        let message: SessionWebSocketMessage;
        try {
          message = JSON.parse(text) as SessionWebSocketMessage;
        } catch {
          sender.send({ type: 'error', error: 'Invalid JSON message' });
          return;
        }

        const existingSession = await sessions.load(sessionId);

        if (message.type === 'abort') {
          existingSession.abort();
          return;
        }

        if (message.type === 'delete') {
          sessions.destroy(sessionId);
          sender.send({ type: 'deleted' });
          ws.close(1000, 'Session deleted');
          return;
        }

        if (message.type === 'prompt') {
          const result = parsePromptBody(
            JSON.stringify({ prompt: message.prompt })
          );
          if (!result.ok) {
            sender.send({ type: 'error', error: result.error });
            return;
          }

          try {
            await existingSession.prompt(result.value);
          } catch (err) {
            if (
              err instanceof APIUserAbortError ||
              (err instanceof Error && err.name === 'AbortError')
            ) {
              sender.send({ type: 'stopped' });
            } else {
              console.error(err);
              sender.send({
                type: 'error',
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      },
      close(ws) {
        const { sessionId } = ws.data;
        activeSessionIds.delete(sessionId);
      },
    },
  });

  logger.info('Running...');
  logger.info('Endpoints: GET /ping, POST /sessions/new, DELETE /sessions/:id');
  logger.info(
    'WebSocket: ws://<host>:<port>/sessions/:id for bi-directional communication'
  );
  logger.info(
    'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
  );
  logger.info(`Listening on port ${server.port}`);
  logger.info('Ctrl+C to stop');

  logger.info('Loading main session...');
  await sessions.load('main');

  return server;
}

function logRequest(req: Request) {
  logger.info(pc.gray(`[${req.method}] ${new URL(req.url).pathname}`));
}
