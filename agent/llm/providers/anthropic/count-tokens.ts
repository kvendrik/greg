import type { CountTokensParams } from '../types';
import type { MessageParam, MessageCountTokensParams } from '@anthropic-ai/sdk/resources/messages';
import { Anthropic } from '@anthropic-ai/sdk';
import { neutralToAnthropic } from './convert';
import config from '../../../../.config';

const anthropic = new Anthropic({ apiKey: config.providers.anthropic.key });

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
