import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import { thread, type PromptOptions } from './llm';
import pc from 'picocolors';

const IDLE_MS = 10 * 60 * 1000; // 10 minutes

type ThreadState = {
  llm: Awaited<ReturnType<typeof thread>>;
  idleTimeout: ReturnType<typeof setTimeout>;
  abortController: AbortController | null;
};

const threads = new Map<string, ThreadState>();

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
    const id = randomUUID();
    const llm = await thread();
    const state: ThreadState = {
      llm,
      idleTimeout: setTimeout(() => {
        threads.delete(id);
        console.log(pc.gray(`Thread ${id} expired (idle 10 min).`));
      }, IDLE_MS),
      abortController: null,
    };
    threads.set(id, state);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id }));
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
    const state = threads.get(id);
    if (!state) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Thread not found' }));
      return;
    }
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
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
    const state = threads.get(id);
    if (state) {
      clearTimeout(state.idleTimeout);
      if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
      }
      threads.delete(id);
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
  const state = threads.get(id);
  if (!state) {
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

    const abortController = new AbortController();
    state.abortController = abortController;

    const promptOptions: PromptOptions = {
      signal: abortController.signal,
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
    };

    try {
      await state.llm.prompt(userPrompt.trim(), promptOptions);
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
    } finally {
      state.abortController = null;
    }
  });
});

server.timeout = 0;

const port = process.env.AGENT_PORT;

if (port === undefined || port === '') {
  throw new Error('AGENT_PORT is required');
}

server.listen(Number(port), () => {
  console.log('Running...');
  console.log(
    'Endpoints: GET /ping, POST /threads/new, POST /threads/:id, POST /threads/:id/abort, DELETE /threads/:id'
  );
  console.log(
    'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
  );
  console.log('Ctrl+C to stop');
});
