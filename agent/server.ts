import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import { createThread, getThread } from './agent';
import pc from 'picocolors';
import config from '../.greg';

function parsePath(url: string): string[] {
  const pathname = new URL(url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean);
}

const server = http.createServer(async (req, res) => {
  console.log(pc.gray(`[${req.method}] ${req.url}`));

  const path = parsePath(req.url ?? '');
  const method = req.method;

  if (path[0] === 'ping' && path.length === 1) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (
    path[0] === 'threads' &&
    path[1] === 'new' &&
    path.length === 2 &&
    method === 'POST'
  ) {
    const thread = await createThread();
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: thread.id }));
    return;
  }

  if (
    path[0] === 'threads' &&
    path[1] &&
    path[2] === 'abort' &&
    path.length === 3 &&
    method === 'POST'
  ) {
    const id = path[1];
    const thread = getThread(id);
    if (!thread) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Thread not found' }));
      return;
    }
    thread.abort();
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end();
    return;
  }

  if (
    path[0] === 'threads' &&
    path[1] &&
    path.length === 2 &&
    method === 'DELETE'
  ) {
    const id = path[1];
    const thread = getThread(id);
    if (thread) {
      thread.delete();
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (
    path[0] !== 'threads' ||
    !path[1] ||
    path.length !== 2 ||
    method !== 'POST'
  ) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const id = path[1];
  const thread = getThread(id);

  if (!thread) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Thread not found' }));
    return;
  }

  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let parsed: { prompt?: string };
    try {
      parsed = JSON.parse(body) as { prompt?: string };
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const userPrompt = parsed?.prompt;
    if (typeof userPrompt !== 'string' || !userPrompt.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or empty "prompt" field' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    req.socket.setTimeout(0);

    try {
      await thread.prompt(userPrompt.trim(), {
        onContent(chunk) {
          res.write(JSON.stringify({ type: 'content', chunk }) + '\n');
        },
        onThinking(chunk) {
          res.write(JSON.stringify({ type: 'thinking', chunk }) + '\n');
        },
        onToolcall(name, args) {
          res.write(
            JSON.stringify({
              type: 'toolcall',
              name,
              args: JSON.stringify(args),
            }) + '\n'
          );
        },
        onDone() {
          res.end();
        },
        onError(err) {
          if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'error', error: err }) + '\n');
            res.end();
          }
        },
      });
    } catch (err) {
      if (
        err instanceof APIUserAbortError ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        if (!res.writableEnded) res.end();
      } else {
        console.error(err);
        if (!res.writableEnded) {
          res.write(
            JSON.stringify({ type: 'error', error: String(err) }) + '\n'
          );
          res.end();
        }
      }
    }
  });
});

server.timeout = 0;

export function startServer() {
  server.listen(Number(config.port), () => {
    console.log('Running...');
    console.log(
      'Endpoints: GET /ping, POST /threads/new, POST /threads/:id, POST /threads/:id/abort, DELETE /threads/:id'
    );
    console.log(
      'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
    );
    console.log('Ctrl+C to stop');
  });
}
