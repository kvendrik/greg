import type { CountTokensParams } from '../types';

/** Rough token estimate: ~4 chars per token for English. */
export async function countTokens(params: CountTokensParams): Promise<number> {
  const messageChars = params.messages.reduce(
    (sum, msg) => sum + msg.content.length,
    0
  );
  const systemChars = params.system.length;
  return Math.ceil((messageChars + systemChars) / 4);
}
