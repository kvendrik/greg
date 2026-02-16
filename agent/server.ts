import http from 'node:http';
import { start } from './llm';
import pc from 'picocolors';

let llm = await start();
let working = false;

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

  if (req.url === '/abort' && working) {
    llm.kill();
    llm = await start();
    working = false;
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end();
    return;
  }

  if (req.url !== '/prompt' || req.method !== 'POST') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  if (working) {
    console.log(pc.red(`[POST] /prompt 503 Agent is already working`));
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent is already working' }));
    return;
  }

  working = true;

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

    try {
      await llm.thread.prompt(userPrompt.trim(), {
        onContent(chunk) {
          res.write(JSON.stringify({ type: 'content', chunk }));
        },
        onThinking(chunk) {
          res.write(JSON.stringify({ type: 'thinking', chunk }));
        },
        onDone() {
          res.end();
        },
      });
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    } finally {
      working = false;
    }
  });
});

server.listen(3000, () => {
  console.log('Running...');
  console.log('Endpoints: POST /prompt, POST /abort, GET /ping');
  console.log(
    'Use a client to interact. E.g. `bun run clients:cli "How are you today?"`'
  );
  console.log('Ctrl+C to stop');
});
