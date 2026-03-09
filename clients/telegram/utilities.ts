import { spawn } from 'node:child_process';
import path from 'node:path';
import { convert } from 'telegram-markdown-v2';
import config from '../../.greg';
import { TaskChannel } from './TaskChannel';

type TelegramConfig = NonNullable<
  NonNullable<typeof config.clients>['telegram']
>;

export function escapeMarkdownV2(text: string): string {
  // Use the official converter so we support full Telegram MarkdownV2 rules.
  // We pass 'escape' to ensure unsupported constructs are safely escaped.
  return convert(text, 'escape');
}

/** Unix socket path for await-reply requests (MCP-style: request/response). */
export const telegramAwaitSocketPath = path.join(
  import.meta.dirname,
  '.telegram-await.sock'
);

/**
 * Sends a message: via send CLI when awaitReply is false; via service socket when true.
 * When awaitReply is true, waits for the user's reply (no timeout) and returns it.
 */
export function sendMessage(
  text: string,
  options: { awaitReply: true }
): Promise<string>;
export function sendMessage(
  text: string,
  options: { awaitReply: false }
): Promise<void>;
export async function sendMessage(
  text: string,
  options: { awaitReply: boolean }
): Promise<string | void> {
  if (options.awaitReply) {
    return TaskChannel.send('await-reply', text, telegramAwaitSocketPath);
  }
  const scriptPath = path.join(import.meta.dirname, 'send-message.ts');
  const proc = spawn('bun', [scriptPath, text], {
    stdio: 'inherit',
  });
  await waitForProcessExit(proc);
}

export async function editTopicName(
  name: string,
  emoji?: string
): Promise<void> {
  const payload = emoji != null ? JSON.stringify({ title: name, emoji }) : name;
  await TaskChannel.send('edit-topic', payload, telegramAwaitSocketPath);
}

export function getTelegramEnv(): TelegramConfig {
  const clients = config.clients;
  if (!clients?.telegram) {
    console.warn(`
Telegram client is not configured. Please configure it in your config.ts file.

\`\`\`ts
const config: Config = {
  ...
  clients: {
    telegram: {
      // Open Telegram, message @BotFather, send /newbot, follow the prompts
      // (name and username ending in _bot); BotFather will reply with your token once
      // (format 123456789:ABCdef...).
      botToken: 'XXX',
      // Your user ID is message.from.id. After sending a message to your bot, run:
      // curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
      // and read "from"."id" in the last message.
      senderId: 'XXX',
    },
  },
  ...
};
\`\`\`  
    `);
    throw new Error(
      'Missing TELEGRAM_BOT_TOKEN. Open Telegram, message @BotFather, send /newbot, follow the prompts (name and username ending in _bot); BotFather will reply with your token once (format 123456789:ABCdef...). Set it in .env and restart.'
    );
  }

  return clients.telegram;
}

function waitForProcessExit(proc: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`send exited with ${code}`));
    });
  });
}
