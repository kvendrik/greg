import type { AgentConfig } from '../service/Agent/types';

export interface Config extends AgentConfig {
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
