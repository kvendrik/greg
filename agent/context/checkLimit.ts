import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { usage } from './usage';

export interface Limits {
  /** Percentage of the context window to compact at (default is 60%). Model recall degrades well
   *  before the hard limit, so we compact proactively.
   * @default 60 */
  softTokenLimit?: number;
}

export const DEFAULT_LIMITS: Required<Limits> = {
  softTokenLimit: 60,
};

interface CheckOptions {
  model: Model<Api>;
  limits?: Limits;
}

export function checkLimit(
  messages: AgentMessage[],
  options: CheckOptions
): { reached: boolean; reason: string } {
  const model = options.model;
  const limits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };

  const currentUsage = usage(messages);
  const contextWindow = model.contextWindow;
  const softLimit = Math.floor(contextWindow * (limits.softTokenLimit / 100));
  const currentTokens = currentUsage.tokens.used;

  if (currentTokens <= softLimit) {
    const reason = `Context is within budget (${currentTokens}/${softLimit} tokens, ${Math.round((currentTokens / softLimit) * 100)}%)`;
    return { reached: false, reason };
  }

  const reason = `Context ${currentTokens} tokens exceeded ${softLimit} soft limit`;
  return { reached: true, reason };
}
