import type { ProviderModelSet } from '../types';

export type OpenAIModel = 'gpt-5-nano' | 'gpt-5.2' | 'o3';

export const models: ProviderModelSet<'openai'> = {
  trivial: {
    modelId: 'gpt-5-nano',
    label: 'GPT 5 Nano',
  },
  normal: {
    modelId: 'gpt-5.2',
    label: 'GPT 5.2',
  },
  complex: {
    modelId: 'gpt-5.2',
    label: 'GPT 5.2',
  },
};
