import type { Model, Api } from '@mariozechner/pi-ai';

export interface Config {
  /**
   * ID to use as the QMD collection name
   */
  id: string;
  /**
   * Path to your workspace folder (Markdown memory files live here).
   * Will be created if it doesn't exist.
   */
  workspace: string;
  /**
   * Port for the agent server. `greg start` to start the server.
   */
  port: string;
  /**
   * Models the agent has access to
   */
  models: (
    | {
        /**
         * The role of the model.
         * Primary means its the preferred model.
         * Fallback means its used when the primary model isn't available.
         * Null means it's only available through a /command.
         */
        role: 'primary';
        /**
         * The model to use. Get using getModel from @mariozechner/pi-ai.
         */
        model: Model<Api>;
        /**
         * The API key for the provider of the model.
         */
        key: string;
      }
    | {
        role: 'fallback' | null;
        /**
         * The command to use to activate the model.
         * Primary model doesn't have a / command considering
         * that it's used by default.
         */
        command: string;
        /**
         * The model to use. Get using getModel from @mariozechner/pi-ai.
         */
        model: Model<Api>;
        /**
         * The API key for the provider of the model.
         */
        key: string;
      }
  )[];
  tools: {
    browser: {
      /**
       * https://cloud.browser-use.com/settings?tab=api-keys&new=1
       */
      key: string;
    };
  };
  clients?: {
    /**
     * When running `greg` in the CLI without any arguments, the first time the server will start.
     * If the server is already running, running `greg` again will start whatever client is set as the default.
     */
    default?: 'cli' | 'telegram';
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
