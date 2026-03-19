import { AgentConfig } from '../agent/types';

export interface Config extends AgentConfig {
  /**
   * Configure to
   * - Use the `greg voice` command to talk to Greg by voice.
   * - Allow Greg to create voice messages using ElevenLabs & send
   *   them to Telegram using `greg telegram send <message> --voice`.
   */
  voice?: {
    elevenlabs?: {
      /**
       * ElevenLabs API key is required for Text to Speech and Speech to Text
       * Features that need this: the TUI voice input (`/v`), `greg tg send --voice`, and `greg hub voicecall`
       */
      key: string;
      /**
       * Voice ID is required for Text to Speech
       * Features that need this: `greg tg send --voice` and `greg hub voicecall`
       */
      voiceId?: string;
    };
  };
  telegram?: {
    /**
     * https://core.telegram.org/bots#how-do-i-create-a-bot
     */
    botToken: string;
    /**
     * Your user ID (e.g. from [@userinfobot](https://t.me/userinfobot)).
     */
    senderId: string;
  };
}
