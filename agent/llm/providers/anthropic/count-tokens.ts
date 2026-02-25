import type { CountTokensParams } from '../types';
import type { MessageParam, MessageCountTokensParams } from '@anthropic-ai/sdk/resources/messages';
import { Anthropic } from '@anthropic-ai/sdk';
import { neutralToAnthropic } from './convert';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function countTokens(params: CountTokensParams): Promise<number> {
  const nativeMessages = neutralToAnthropic(params.messages);
  const model = params.model ?? 'claude-sonnet-4-6';
  const { input_tokens } = await anthropic.messages.countTokens({
    model,
    system: params.system,
    messages: nativeMessages as MessageParam[],
    tools: params.tools as MessageCountTokensParams['tools'],
  });
  return input_tokens;
}
