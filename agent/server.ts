import http from 'node:http';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import { createThread, getThread } from './agent';
import pc from 'picocolors';
import config from '../.greg';

function parsePath(url: string): string[] {
  const pathname = new URL(url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean);
}

const server = http.createServer((req, res) => {
  void (async () => {
  console.log(pc.gray(`[${req.method ?? 'GET'}] ${req.url ?? '/'}`));

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

  req.on('data', (chunk: Buffer | string) => {
    body += typeof chunk === 'string' ? chunk : chunk.toString();
  });

  req.on('end', () => {
    void (async () => {
    type Image = {
      data: string;
      mimeType: string;
    };

    type PromptInput = { content: string; images: Image[] };

    let parsed: { prompt?: PromptInput };
    try {
      parsed = JSON.parse(body) as { prompt?: PromptInput };
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const userPrompt = parsed?.prompt;
    if (!userPrompt || typeof userPrompt !== 'object') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid "prompt" field' }));
      return;
    }
    if (typeof userPrompt.content !== 'string' || !userPrompt.content.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or empty prompt content' }));
      return;
    }
    if (!Array.isArray(userPrompt.images)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Prompt "images" must be an array' }));
      return;
    }
    for (let i = 0; i < userPrompt.images.length; i++) {
      const img = userPrompt.images[i];
      if (
        typeof img?.data !== 'string' ||
        typeof img?.mimeType !== 'string' ||
        !img.mimeType.trim()
      ) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: `Each image must have "data" and "mimeType" (invalid at index ${i})`,
          })
        );
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    req.socket.setTimeout(0);

    try {
      await thread.prompt(userPrompt, {
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
          res.end(JSON.stringify({ type: 'done' }) + '\n');
        },
        onStop() {
          res.end(JSON.stringify({ type: 'stopped' }) + '\n');
        },
        onError(err) {
          if (!res.writableEnded) {
            res.end(JSON.stringify({ type: 'error', error: err }) + '\n');
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
  })();
  });
  })();
});

server.timeout = 0;

export function startServer() {
  server.listen(Number(config.port), () => {
    console.log('Running...');
    console.log(
      'Endpoints: GET /ping, POST /threads/new, POST /threads/:id, DELETE /threads/:id'
    );
    console.log(
      'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
    );
    console.log('Ctrl+C to stop');
  });
}
