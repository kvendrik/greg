import type { ProviderModelSet } from '../types';

export type GeminiModel =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-pro-preview';

export const models: ProviderModelSet<'gemini'> = {
  trivial: {
    modelId: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
  },
  normal: {
    modelId: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
  },
  complex: {
    modelId: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
  },
};
