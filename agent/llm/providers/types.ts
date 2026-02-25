import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

export type TaskComplexity = 'trivial' | 'normal' | 'complex';

export type ProviderId = 'anthropic' | 'openai';

export type ProviderModel = {
  modelId: string;
  label: string;
};

/** Requires a model to be defined for every TaskComplexity. */
export type ProviderModelSet = { [K in TaskComplexity]: ProviderModel };

/** Provider-agnostic message format for thread history. */
export type NeutralMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    }
  | { role: 'tool'; toolCallId: string; content: string };

export type RunParams = {
  system: string;
  /** Prepared messages (new user content already appended / summarized by context). */
  messages: NeutralMessage[];
  model: string;
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
  onError: (errorType: import('../utilities/errors').ErrorType) => void | boolean | Promise<void | boolean>;
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

export type ProviderCountTokens = (params: CountTokensParams) => Promise<number>;

export type ProviderConvertMessages = (messages: NeutralMessage[]) => unknown;

export type SummarizeResult = { note: string; condensed_summary: string } | null;

export type ProviderSummarize = (params: {
  system: string;
  messages: unknown;
  model: string;
}) => Promise<SummarizeResult>;
