import http from 'node:http';
import twilio from 'twilio';
import { prompt, ping } from '../agent/utilities';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_ACCOUNT_SECRET;
export const client = twilio(accountSid, authToken);

const PORT = 3010;
const WEBHOOK_SECRET = uuidv4().replace(/-/g, '');

if (!(await ping())) {
  console.error('Agent is not running');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  if (!req.url.includes(WEBHOOK_SECRET)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  let llmState = { working: false, response: '' };

  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    const params = Object.fromEntries(new URLSearchParams(body));
    const signature = req.headers['x-twilio-signature'] as string | undefined;

    const from = params.From ?? '';
    const to = params.To ?? '';
    const messageBody = params.Body ?? '';
    const messageSid = params.MessageSid ?? '';

    console.log('[Twilio] Incoming message', {
      from,
      to,
      messageSid,
      body: messageBody,
    });

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    llmState.working = true;

    prompt(messageBody, {
      onThinking: (chunk) => {
        process.stdout.write(chalk.gray(chunk));
      },
      onContent: (chunk) => {
        process.stdout.write(chalk.green(chunk));
        llmState.response += chunk;
      },
      onDone: async () => {
        process.stdout.write(`\n\nSending response to ${from} from ${to}...`);
        await client.messages.create({
          from: to,
          to: from,
          body: llmState.response,
        });
        llmState.working = false;
        llmState.response += '';
        process.stdout.write(`done. ${chalk.green('✓')}\n`);
      },
    });
  });
});

server.listen(PORT, () => {
  const webhookUrl = `http://localhost:${PORT}?${WEBHOOK_SECRET}`;
  console.log(`Twilio webhook: ${webhookUrl}`);
});
