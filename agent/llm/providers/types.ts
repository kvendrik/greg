import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { type AnthropicModel } from './anthropic/models';
import { type OpenAIModel } from './openai/models';

export type TaskComplexity = 'trivial' | 'normal' | 'complex';
export const PROVIDERS = ['anthropic', 'openai'];
export type ProviderId = 'anthropic' | 'openai';

export type ProviderModel<P extends ProviderId> = {
  modelId: P extends 'anthropic' ? AnthropicModel : OpenAIModel;
  label: string;
};

/** Requires a model to be defined for every TaskComplexity. */
export type ProviderModelSet<P extends ProviderId> = {
  [K in TaskComplexity]: ProviderModel<P>;
};

/** Provider-agnostic image source for user message content. */
export type NeutralImageSource =
  | {
      type: 'base64';
      data: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    }
  | { type: 'url'; url: string }
  | { type: 'file'; fileId: string };

/** Provider-agnostic message format for thread history. */
export type NeutralMessage =
  | {
      role: 'user';
      content: (
        | { type: 'text'; content: string }
        | { type: 'image'; source: NeutralImageSource }
        | Array<{ type: 'tool_result'; toolCallId: string; content: string }>
      )[];
    }
  | {
      role: 'assistant';
      content: (
        | { type: 'text'; content: string }
        | { type: 'thinking'; content: string }
        | Array<{
            type: 'tool_use';
            id: string;
            name: string;
            input: Record<string, unknown>;
          }>
      )[];
    };

export type RunParams = {
  system: string;
  /** Prepared messages (new user content already appended / summarized by context). */
  messages: NeutralMessage[];
  model: ProviderModel<ProviderId>['modelId'];
  tools: BetaRunnableTool[];
  conversationStartIso: string;
  signal: AbortSignal;
};

export type RunCallbacks = {
  onContent: (chunk: string) => void;
  onToolCall: (name: string, args: string) => void;
  onThinking: (chunk: string) => void;
  onDone: (messages: NeutralMessage[]) => void;
  /** Return true (or resolve to true) if the error was handled (e.g. retried); then the provider will not rethrow. */
  onError: (
    errorType: import('../utilities/errors').ErrorType
  ) => void | boolean | Promise<void | boolean>;
};

export type ProviderRun = (
  params: RunParams,
  callbacks: RunCallbacks
) => Promise<void>;

export type CountTokensParams = {
  system: string;
  messages: NeutralMessage[];
  tools: BetaRunnableTool[];
  model?: string;
};

export type ProviderCountTokens = (
  params: CountTokensParams
) => Promise<number>;

export type ProviderConvertMessages = (messages: NeutralMessage[]) => unknown;

export type SummarizeResult = {
  note: string;
  condensed_summary: string;
} | null;

export type ProviderSummarize = (params: {
  system: string;
  messages: unknown;
  model: string;
}) => Promise<SummarizeResult>;

export type ProviderEntry<P extends ProviderId> = {
  run: ProviderRun;
  models: ProviderModelSet<P>;
  countTokens: ProviderCountTokens;
  convertMessages: ProviderConvertMessages;
  summarize: ProviderSummarize;
};
