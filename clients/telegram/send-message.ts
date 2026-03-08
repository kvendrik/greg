#!/usr/bin/env bun
import { Command } from 'commander';
import { Bot, type Context } from 'grammy';
import pc from 'picocolors';
import { cliAwaitingReply, createSendAwaitingLock, getTelegramEnv } from './utilities';

export const sendCommand = new Command('send');

sendCommand
  .description('Send a message to the configured Telegram user')
  .argument('<message>', 'message to send')
  .option(
    '--await-reply',
    'wait for a reply, then exit. When stdout is not a TTY, only the reply is printed (for easy capture)'
  )
  .action(async (message: string, options: { awaitReply?: boolean }) => {
    const isTty = process.stdout.isTTY;
    const { botToken, senderId } = getTelegramEnv();
    const bot = new Bot<Context>(botToken);

    await bot.api.sendMessage(senderId, message);
    if (isTty) {
      console.log(pc.green('📤 Sent'), pc.dim(message));
    }

    if (options.awaitReply) {
      const reply = await waitForReply(bot, senderId, isTty);
      if (isTty) {
        console.log(pc.green('💬 Reply:'), reply);
      } else {
        console.log(reply);
      }
    }

    if (import.meta.main) process.exit(0);
  });

/** Wait for a text reply from the configured sender. Lock tells the service to stop polling so we receive it. */
async function waitForReply(
  bot: Bot<Context>,
  senderId: string,
  isTty: boolean
): Promise<string> {
  if (isTty) {
    console.log(
      pc.cyan('⏳ Waiting for reply…'),
      pc.dim('(no timeout, reply whenever you like)')
    );
  }
  createSendAwaitingLock();
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await new Promise<string>((resolve) => {
      bot.on('message:text', (ctx) => {
        if (String(ctx.from?.id) === String(senderId)) {
          bot.stop();
          resolve(ctx.message.text);
        }
      });
      void bot.start({ timeout: 50 });
    });
  } finally {
    cliAwaitingReply.removeLock();
  }
}

if (import.meta.main) {
  sendCommand.parse();
}
