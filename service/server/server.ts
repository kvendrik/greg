import { serve, type Server, type ServerWebSocket } from 'bun';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import * as session from '../session';
import pc from 'picocolors';
import config from '../../.greg';
import type { PromptInput } from '../Agent/Agent';
import { createSender, parsePromptBody } from './utilities';

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

let server: Server<WebSocketData> | null = null;
const activeSessionIds = new Set<string>();

export function startServer(port = Number(config.port)) {
  if (server) {
    return server;
  }

  server = serve<WebSocketData>({
    port,
    async fetch(req, bunServer) {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const method = req.method;

      console.log(pc.gray(`[${method}] ${pathname}`));

      if (pathname === '/ping' && method === 'GET') {
        return Response.json({ status: 'ok' });
      }

      if (pathname === '/sessions' && method === 'GET') {
        return Response.json({
          sessions: session.listIds(),
          activeSessions: Array.from(activeSessionIds),
        });
      }

      if (pathname === '/sessions/new' && method === 'POST') {
        let idSuffix: string | undefined;
        try {
          const bodyText = await req.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText) as { idSuffix?: unknown };
            if (
              typeof parsed.idSuffix === 'string' &&
              parsed.idSuffix.trim() !== ''
            ) {
              idSuffix = parsed.idSuffix;
            }
          }
        } catch {
          // ignore malformed body, fall back to random ID
        }

        const newSession = await session.create(idSuffix ?? '');
        return new Response(JSON.stringify({ id: newSession.id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);

      if (sessionMatch && method === 'DELETE') {
        const id = sessionMatch[1];
        const existingSession = session.get(id);
        if (existingSession) {
          existingSession.delete();
        }
        return new Response(null, { status: 204 });
      }

      if (sessionMatch && method === 'GET') {
        const id = sessionMatch[1];
        const success = bunServer.upgrade(req, {
          data: { sessionId: id },
        });
        if (success) {
          return;
        }
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      return new Response('Not found', { status: 404 });
    },
    websocket: {
      data: {} as WebSocketData,
      open(ws) {
        const { sessionId } = ws.data;
        activeSessionIds.add(sessionId);
        const existingSession = session.get(sessionId);

        if (!existingSession) {
          createSender<AgentEvent>(ws).send({
            type: 'error',
            error: 'Session not found',
          });
          ws.close(1008, 'Session not found');
          return;
        }

        const sender = createSender<AgentEvent>(ws);

        existingSession.listen({
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
        const existingSession = session.get(sessionId);

        if (!existingSession) {
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

        if (message.type === 'abort') {
          existingSession.abort();
          return;
        }

        if (message.type === 'delete') {
          existingSession.delete();
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

  console.log('Running...');
  console.log('Endpoints: GET /ping, POST /sessions/new, DELETE /sessions/:id');
  console.log(
    'WebSocket: ws://<host>:<port>/sessions/:id for bi-directional communication'
  );
  console.log(
    'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
  );
  console.log(`Listening on port ${server.port}`);
  console.log('Ctrl+C to stop');

  return server;
}
