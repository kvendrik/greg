import type {
  ProviderId,
  ProviderRun,
  ProviderModelSet,
  ProviderCountTokens,
  ProviderConvertMessages,
  ProviderSummarize,
} from './types';
import { run as runAnthropicImpl, models as modelsAnthropicImpl, countTokens as countTokensAnthropic, convertMessages as convertMessagesAnthropic, summarize as summarizeAnthropic } from './anthropic';
import { run as runOpenAIImpl, models as modelsOpenAIImpl, countTokens as countTokensOpenAI, convertMessages as convertMessagesOpenAI } from './openai';

export type ProviderEntry = {
  run: ProviderRun;
  models: ProviderModelSet;
  countTokens: ProviderCountTokens;
  convertMessages: ProviderConvertMessages;
  summarize?: ProviderSummarize;
};

export const providers: Record<ProviderId, ProviderEntry> = {
  anthropic: { run: runAnthropicImpl, models: modelsAnthropicImpl, countTokens: countTokensAnthropic, convertMessages: convertMessagesAnthropic, summarize: summarizeAnthropic },
  openai: { run: runOpenAIImpl, models: modelsOpenAIImpl, countTokens: countTokensOpenAI, convertMessages: convertMessagesOpenAI },
};
