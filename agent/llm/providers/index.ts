import type { ProviderId, ProviderEntry } from './types';
import { provider as anthropicProvider } from './anthropic';
import { provider as openaiProvider } from './openai';

export type { ProviderEntry } from './types';

export const providers: Record<ProviderId, ProviderEntry> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};
