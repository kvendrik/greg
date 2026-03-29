import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { getLatestAssistantUsage, usage } from './usage';

export interface Limits {
  /** Percentage of the context window to compact at (default is 60%). Model recall degrades well
   *  before the hard limit, so we compact proactively.
   * @default 60 */
  softTokenLimit?: number;
  /** High cache-write cost (in USD) signals a bloated context even when token
   *  counts look fine. Assumes Sonnet-class pricing (~$3/MTok input);
   *  adjust if the default model tier changes significantly.
   * @default 0.05 */
  cacheWriteCostLimit?: number;
  /** If cache-write tokens exceed this share of the context window,
   *  trigger compaction. Catches uncached context growth that the
   *  token-based soft limit might miss on the first turn after a
   *  cache bust.
   * @default 40 */
  cacheWriteTokenLimit?: number;
}

export const DEFAULT_LIMITS: Required<Limits> = {
  softTokenLimit: 60,
  cacheWriteCostLimit: 0.05,
  cacheWriteTokenLimit: 40,
};

interface CheckOptions {
  model: Model<Api>;
  limits?: Limits;
}

export function checkLimit(
  messages: AgentMessage[],
  options: CheckOptions,
): { reached: boolean; reason: string } {
  const model = options.model;
  const limits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };

  const currentUsage = usage(messages);
  const contextWindow = model.contextWindow;
  const softLimit = Math.floor(contextWindow * (limits.softTokenLimit / 100));

  const latestTurnTokenLimit = Math.floor(
    contextWindow * (limits.cacheWriteTokenLimit / 100),
  );

  const currentTokens = currentUsage.tokens.used;
  const latestUsage = getLatestAssistantUsage(messages);
  const latestTurnCacheWriteCost =
    currentUsage.cost.cacheWrite === 0
      ? undefined
      : currentUsage.cost.cacheWrite;
  const latestTurnCacheWriteTokens = latestUsage?.cacheWrite ?? 0;

  if (
    typeof latestTurnCacheWriteCost === 'number' &&
    latestTurnCacheWriteCost >= limits.cacheWriteCostLimit
  ) {
    const reason = `Cache write cost $${latestTurnCacheWriteCost.toFixed(4)} exceeded $${limits.cacheWriteCostLimit.toFixed(2)} threshold`;
    return { reached: true, reason };
  }

  if (latestTurnCacheWriteTokens >= latestTurnTokenLimit) {
    const reason = `Cache write tokens ${latestTurnCacheWriteTokens} exceeded ${latestTurnTokenLimit} token threshold`;
    return { reached: true, reason };
  }

  if (currentTokens <= softLimit) {
    const reason = `Context is within budget (${currentTokens}/${softLimit} tokens, ${Math.round((currentTokens / softLimit) * 100)}%)`;
    return { reached: false, reason };
  }

  const reason = `Context ${currentTokens} tokens exceeded ${softLimit} soft limit`;
  return { reached: true, reason };
}
