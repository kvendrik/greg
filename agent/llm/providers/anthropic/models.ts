import type { ProviderModelSet } from '../types';

export type AnthropicModel =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6';

export const models: ProviderModelSet<'anthropic'> = {
  trivial: {
    modelId: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
  },
  normal: {
    modelId: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
  },
  complex: {
    modelId: 'claude-opus-4-6',
    label: 'Opus 4.6',
  },
};
