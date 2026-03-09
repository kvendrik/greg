#!/usr/bin/env bun
import { Command } from 'commander';
import { Bot, type Context } from 'grammy';
import pc from 'picocolors';
import { escapeMarkdownV2, getTelegramEnv } from './utilities';

export const sendCommand = new Command('send');

sendCommand
  .description('Send a message to the configured Telegram user')
  .argument('<message>', 'message to send')
  .action(async (message: string) => {
    const isTty = process.stdout.isTTY;
    const { botToken, senderId } = getTelegramEnv();
    const bot = new Bot<Context>(botToken);
    const escaped = escapeMarkdownV2(message);

    await bot.api.sendMessage(senderId, escaped);
    if (isTty) {
      console.log(pc.green('📤 Sent'), pc.dim(message));
    }

    process.exit(0);
  });

if (import.meta.main) {
  sendCommand.parse();
}
