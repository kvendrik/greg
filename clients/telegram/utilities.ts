import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import config from '../../.greg';

type TelegramConfig = NonNullable<
  NonNullable<typeof config.clients>['telegram']
>;

/** Lock file: when present, the send CLI is awaiting a reply and the service yields polling. */
const cliAwaitingLockPath = path.join(
  import.meta.dirname,
  '.telegram-send-awaiting'
);

export const cliAwaitingReply = {
  isAwaiting(): boolean {
    return fs.existsSync(cliAwaitingLockPath);
  },
  getLockPath(): string {
    return cliAwaitingLockPath;
  },
  removeLock(): void {
    fs.rmSync(cliAwaitingLockPath, { force: true });
  },
};

export function createSendAwaitingLock(): void {
  fs.writeFileSync(cliAwaitingLockPath, '');
}

/**
 * Sends a message via the send CLI. When awaitReply is true, waits for the
 * user's reply (no timeout – can take hours) and returns it.
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
  const scriptPath = path.join(import.meta.dirname, 'send-message.ts');
  const args = [scriptPath, text];
  if (options.awaitReply) args.push('--await-reply');
  const proc = spawn('bun', args, {
    stdio: ['ignore', options.awaitReply ? 'pipe' : 'inherit', 'inherit'],
  });

  if (options.awaitReply) {
    const chunks: Buffer[] = [];
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    await waitForProcessExit(proc);
    return Buffer.concat(chunks).toString('utf-8').trim();
  }

  await waitForProcessExit(proc);
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

function waitForProcessExit(
  proc: ReturnType<typeof spawn>
): Promise<void> {
  return new Promise((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`send exited with ${code}`));
    });
  });
}
