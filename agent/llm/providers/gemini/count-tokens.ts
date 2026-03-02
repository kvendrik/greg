import type { CountTokensParams } from '../types';
import { GoogleGenAI } from '@google/genai';
import { neutralToGemini } from './convert';
import config from '../../../../.config';

const ai = new GoogleGenAI({ apiKey: config.providers.gemini.key });

export async function countTokens(params: CountTokensParams): Promise<number> {
  const model = params.model;
  const contents = neutralToGemini(params.messages);
  const response = await ai.models.countTokens({
    model,
    contents,
  });
  const messageTokens = response.totalTokens ?? 0;
  const systemEstimate = Math.ceil(params.system.length / 4);
  return messageTokens + systemEstimate;
}
