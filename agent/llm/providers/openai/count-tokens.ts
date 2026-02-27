import type { CountTokensParams } from '../types';

function messageContentLength(msg: CountTokensParams['messages'][number]): number {
  let len = 0;
  for (const part of msg.content) {
    if (Array.isArray(part)) {
      for (const block of part) {
        const str = 'content' in block && typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block);
        len += str.length;
      }
    } else {
      len += part.content.length;
    }
  }
  return len;
}

/** Rough token estimate: ~4 chars per token for English. */
export async function countTokens(params: CountTokensParams): Promise<number> {
  const messageChars = params.messages.reduce(
    (sum, msg) => sum + messageContentLength(msg),
    0
  );
  const systemChars = params.system.length;
  return Math.ceil((messageChars + systemChars) / 4);
}
