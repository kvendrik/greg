import http from 'node:http';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import { start } from './llm';
import pc from 'picocolors';
import { spawn } from 'node:child_process';

const llm = await start();
let currentAbortController: AbortController | null = null;

process.on('SIGINT', () => {
  llm.kill();
  process.exit(0);
});

const server = http.createServer(async (req, res) => {
  console.log(pc.gray(`[${req.method}] ${req.url}`));

  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/abort' && req.method === 'POST' && currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end();
    return;
  }

  if (req.url !== '/prompt' || req.method !== 'POST') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  if (currentAbortController) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(
      JSON.stringify({ type: 'content', chunk: 'Working on that request...' }) +
        '\n'
    );
    res.end();
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

    // Disable socket timeout so long-running tool calls (e.g. exec) don't get cut off
    req.socket.setTimeout(0);

    const abortController = new AbortController();
    currentAbortController = abortController;

    try {
      await llm.thread.prompt(userPrompt.trim(), {
        signal: abortController.signal,
        onContent(chunk) {
          res.write(JSON.stringify({ type: 'content', chunk }) + '\n');
        },
        onThinking(chunk) {
          res.write(JSON.stringify({ type: 'thinking', chunk }) + '\n');
        },
        onDone() {
          res.end();
        },
      });
    } catch (err) {
      if (
        err instanceof APIUserAbortError ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        res.end();
      } else {
        console.error(err);
        res.write(JSON.stringify({ type: 'error', error: String(err) }) + '\n');
        res.end();
      }
    } finally {
      currentAbortController = null;
    }
  });
});

// No timeout so long-running prompts (e.g. with exec) are not cut off
server.timeout = 0;

server.listen(3000, () => {
  console.log('Running...');
  console.log('Endpoints: POST /prompt, POST /abort, GET /ping');
  console.log(
    'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
  );
  console.log('Ctrl+C to stop');
});
