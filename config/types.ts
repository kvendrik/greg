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
      key: string;
      voiceId: string;
    };
  };
  clients?: {
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
  };
}
