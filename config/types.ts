import type { Model, Api } from '@mariozechner/pi-ai';
import type { GuardMethods } from '../agent/tools/utilities/guard/guard';

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
    guard?: {
      /**
       * Enables the guard tool.
       * This means that the agent will run all output from
       * the browser, web, and exec tools through a guard to attempt to detect malicious content.
       */
      enabled: boolean;
      /**
       * The method to use for the guard.
       * `patterns` means that the guard will use a set of Regex patterns to detect malicious content.
       * `classifier` means that the guard will use the classifier HTTP service (ModernBERT) to detect malicious content.
       * `all` means that the guard will use both patterns and classifier to detect malicious content.
       */
      use: GuardMethods;
      /**
       * Port the guard classifier HTTP service listens on.
       * Default is 7234.
       */
      port?: number;
      /**
       * The timeout for the classifier in milliseconds.
       * Default is 15 seconds (15_000).
       */
      timeout?: number;
      /**
       * Allowlist of commands and URLs that are trusted.
       * These will either not be ran through the guard or with a specific `use` setting.
       */
      allowlist?: {
        exec?: {
          [command: string]:
            | { trusted: false; use: GuardMethods }
            | { trusted: true };
        };
        webFetch?: {
          [domain: string]:
            | { trusted: false; use: GuardMethods }
            | { trusted: true };
        };
      };
    };
    browser?: {
      /**
       * Enables the browser automation tool using Browser Use
       * and their blazingly fast finetuned model.
       * https://cloud.browser-use.com/settings?tab=api-keys&new=1
       */
      key: string;
    };
    webSearch?: {
      /**
       * Web Search tool uses Google Gemini API to search the web.
       * https://cloud.google.com/gemini-api/docs/get-started
       */
      geminiKey: string;
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
