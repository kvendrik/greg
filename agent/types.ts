import type { Model, Api } from '@mariozechner/pi-ai';
import type { HeartbeatOptions } from '../gateway/heartbeat/types';
export type { Config as BaseConfig } from '../config';
import type { BackgroundUpdate as SubAgentBackgroundUpdate } from './tools/spawn/spawn';
import type { BackgroundUpdate as ExecBackgroundUpdate } from './tools/exec';
import type { AllowedBins, AllowedProfiles } from './tools/exec/policy';

export interface ToolContext {
  config: AgentConfig;
  onBackgroundUpdate: (
    update: SubAgentBackgroundUpdate | ExecBackgroundUpdate
  ) => void;
}

type OptionalToolId =
  | 'memory'
  | 'exec'
  | 'browser_use'
  | 'web_search'
  | 'web_fetch'
  | 'subagents'
  | 'skills'
  | 'files';

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
  tools: {
    /**
     * Deny tools.
     */
    deny?: OptionalToolId[];
    /**
     * Allow tools.
     */
    allow?: OptionalToolId[];
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
    guard: {
      /**
       * Enables the guard tool which will block exec commands that are not allowed.
       * `true` by default.
       */
      enabled: boolean;
      /**
       * Ask for permission to run a tool when it's not allowed.
       */
      ask?: boolean;
      exec?: {
        allowBins: AllowedBins;
        profiles: AllowedProfiles;
      };
    };
  };
}
