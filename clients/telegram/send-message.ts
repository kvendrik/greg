#!/usr/bin/env bun
import { Command } from 'commander';
import pc from 'picocolors';
import { sendMessage } from './utilities';

export const sendCommand = new Command('send');

sendCommand
  .description('Send a message to the configured Telegram user')
  .option('--voice', 'send the message as a voice message')
  .option('--await-reply', "wait for the user's reply")
  .argument('<message>', 'message to send')
  .action(
    async (
      message: string,
      options: { voice?: boolean; awaitReply?: boolean }
    ) => {
      const isTty = process.stdout.isTTY;

      await sendMessage(message, {
        awaitReply: options.awaitReply ?? false,
        voice: options.voice ?? false,
      });

      if (isTty) {
        const prefix = options.voice ? '📤 Sent as voice' : '📤 Sent';
        console.log(pc.green(prefix), pc.dim(message));
      }

      process.exit(0);
    }
  );

if (import.meta.main) {
  sendCommand.parse();
}
