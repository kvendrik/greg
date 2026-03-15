import type { Model, Api } from '@mariozechner/pi-ai';
import type { HeartbeatOptions } from '../gateway/heartbeat/types';
export type { Config as BaseConfig } from '../config';

export interface ToolContext {
  config: AgentConfig;
}

type OptionalToolId =
  | 'memory'
  | 'exec'
  | 'browser_use'
  | 'web_search'
  | 'web_fetch';

export interface AgentConfig {
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
  port: number;
  /** Heartbeat: periodic main-session runs using workspace HEARTBEAT.md. */
  heartbeat?: HeartbeatOptions;
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
  tools?: {
    /**
     * Deny optional tools. Skill and file tools are always allowed.
     */
    deny?: OptionalToolId[];
    browser?: {
      /**
       * Enables the browser automation tool using Browser Use
       * and their blazingly fast finetuned model.
       * https://cloud.browser-use.com/settings?tab=api-keys&new=1
       */
      key: string;
    };
    webSearch?: {
      provider: 'brave' | 'gemini';
      /**
       * Web Search tool uses Google Gemini API to search the web.
       * https://cloud.google.com/gemini-api/docs/get-started
       */
      key: string;
    };
    guard?: {
      /**
       * Enables the guard tool.
       * This means that the agent will run all output from
       * the browser, web, and exec tools through a guard to attempt to detect malicious content.
       */
      enabled: boolean;
    };
  };
}
