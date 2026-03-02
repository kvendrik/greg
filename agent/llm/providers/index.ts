import type { ProviderId, ProviderEntry } from './types';
import { provider as anthropicProvider } from './anthropic';
import { provider as geminiProvider } from './gemini';
import { provider as openaiProvider } from './openai';

export type {
  ProviderEntry,
  ProviderId,
  ProviderModelSet,
  ProviderModel,
} from './types';

export const providers: Record<ProviderId, ProviderEntry<ProviderId>> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
};
