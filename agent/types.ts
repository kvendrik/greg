export type { Config as BaseConfig } from '../config';

import type { Model, Api } from '@mariozechner/pi-ai';
import type { GuardMethods } from './tools/utilities/guard/guard';

export interface ToolContext {
  config: AgentConfig;
}

/**
 * Trusted means the output is trusted to be safe and won't be ran through the guard.
 * Allow means the input is allowed to run.
 */
export type AllowListEntry = { trusted: boolean; allow: boolean };
export type AllowList = Record<string, AllowListEntry>;

export interface CronRetryConfig {
  maxAttempts?: number;
  backoffMs?: number[];
  retryOn?: string[];
}

export interface CronRunLogConfig {
  maxBytes?: number;
  keepLines?: number;
}

export interface CronConfig {
  /** If false, cron scheduler does not start. Default true. */
  enabled?: boolean;
  /** Override job store path (default: workspace/cron/jobs.json). */
  store?: string;
  /** Max concurrent job runs. Default 1. */
  maxConcurrentRuns?: number;
  /** Retry policy (shape only; behavior in later tier). */
  retry?: CronRetryConfig;
  /** Run log pruning. */
  runLog?: CronRunLogConfig;
}

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
  port: string;
  /** Cron scheduler and job store config. */
  cron?: CronConfig;
  /** Heartbeat: periodic main-session runs using workspace HEARTBEAT.md. */
  heartbeat?: {
    enabled?: boolean;
    intervalMs?: number;
    activeHours?: { start: string; end: string; timezone?: string };
    prompt?: string;
    ackMaxChars?: number;
    jitterMs?: number;
    includeReasoning?: boolean;
    target?: 'last' | 'none';
    runLog?: { maxBytes?: number; keepLines?: number };
  };
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
      allowlist?: {
        /**
         * Allowlist of commands that are allowed and/or trusted.
         *
         * The command string is a full command string, including arguments.
         * For example: "git pull" or "npm install" or "rm -rf ./tmp/new-file.log".
         *
         * The AllowListEntry object has two properties:
         * - trusted: boolean - whether the command output is trusted.
         *   If trusted is true, the output will NOT be ran through the guard.
         * - allow: boolean - whether the domain or command is allowed.
         *   If a command is not allowed, the user will be asked to confirm before running.
         */
        exec?: AllowList;
        webFetch?: AllowList;
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
      provider: 'brave' | 'gemini';
      /**
       * Web Search tool uses Google Gemini API to search the web.
       * https://cloud.google.com/gemini-api/docs/get-started
       */
      key: string;
    };
  };
}
