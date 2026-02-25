import type { ProviderModelSet } from '../types';

export const models: ProviderModelSet = {
  trivial: {
    modelId: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
  },
  normal: {
    modelId: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
  },
  complex: {
    modelId: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
  },
} satisfies ProviderModelSet;
