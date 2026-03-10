#!/usr/bin/env bun
import { Command } from 'commander';
import { Bot, type Context } from 'grammy';
import pc from 'picocolors';
import {
  escapeMarkdownV2,
  getTelegramEnv,
  telegramAwaitSocketPath,
} from './utilities';
import { TaskChannel } from '../TaskChannel';

export const sendCommand = new Command('send');

sendCommand
  .description('Send a message to the configured Telegram user')
  .argument('<message>', 'message to send')
  .action(async (message: string) => {
    const isTty = process.stdout.isTTY;
    const { botToken, senderId } = getTelegramEnv();
    const bot = new Bot<Context>(botToken);
    const escaped = escapeMarkdownV2(message);

    let sentViaService = false;
    try {
      await TaskChannel.send('send-message', escaped, telegramAwaitSocketPath);
      sentViaService = true;
    } catch {
      await bot.api.sendMessage(senderId, escaped);
    }

    if (isTty) {
      const prefix = sentViaService ? '📤 Sent via service' : '📤 Sent';
      console.log(pc.green(prefix), pc.dim(message));
    }

    process.exit(0);
  });

if (import.meta.main) {
  sendCommand.parse();
}
