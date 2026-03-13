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
      await sendMessage(message, {
        awaitReply: options.awaitReply ?? false,
        voice: options.voice ?? false,
      });

      const log = options.voice
        ? '📤 Sent & delivered as voice message'
        : '📤 Sent & delivered as text message';

      console.log(pc.green(log));

      process.exit(0);
    }
  );

if (import.meta.main) {
  sendCommand.parse();
}
