import type { ProviderEntry } from '../types';
import { run } from './llm';
import { models } from './models';
import { countTokens } from './count-tokens';
import { neutralToOpenAI as convertMessages } from './convert';
import { summarize } from './summarize';

export const provider: ProviderEntry<'openai'> = {
  run,
  models,
  countTokens,
  convertMessages,
  summarize,
};
