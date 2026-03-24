#!/usr/bin/env bun
import { type Context, InputFile } from 'grammy';
import { bot, senderId } from './bot';
import { synthesizeToBuffer } from '../../voice/speech';
import { get as getConfig } from '../../config';
import { convert } from 'telegram-markdown-v2';

const config = await getConfig();

/**
 * Sends a message: via send CLI when awaitReply is false; via service socket when true.
 * When awaitReply is true, waits for the user's reply (no timeout) and returns it.
 */
export async function sendMessage(
  text: string,
  options: {
    voice?: boolean;
    context?: Context;
    type?: 'text' | 'markdown';
  } = { type: 'text' }
): Promise<void> {
  if (options?.voice) {
    const voiceId = config.voice?.elevenlabs?.voiceId;
    if (voiceId == null || voiceId === '') {
      throw new Error('ElevenLabs voiceId is not configured (voice.elevenlabs.voiceId)');
    }
    const audioBuffer = await synthesizeToBuffer(text, {
      voiceId,
      useV3: true,
    });

    const voiceFile = new InputFile(audioBuffer, 'voice.mp3');
    await bot.api.sendVoice(senderId, voiceFile);

    return;
  }

  if (options?.context) {
    if (text.length > 4000) {
      await options?.context.replyWithDocument(
        new InputFile(text, 'content.md')
      );
    } else {
      const content =
        options.type === 'markdown' ? convert(text, 'escape') : text;
      await options?.context.reply(content, {
        parse_mode: options.type === 'markdown' ? 'MarkdownV2' : undefined,
      });
    }
    return;
  }

  if (text.length > 4000) {
    await bot.api.sendDocument(senderId, new InputFile(text, 'content.md'));
  } else {
    const content =
      options.type === 'markdown' ? convert(text, 'escape') : text;
    await bot.api.sendMessage(senderId, content, {
      parse_mode: options.type === 'markdown' ? 'MarkdownV2' : undefined,
    });
  }
}
