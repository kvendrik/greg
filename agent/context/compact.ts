import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { createLogger } from '../../utilities/logger';
import {
  CONTEXT_SOFT_LIMIT_RATIO,
  getLatestAssistantUsage,
  usage,
} from './usage';
import { summarize } from './summarize';

const logger = createLogger('Compact');

const LATEST_TURN_CACHE_WRITE_COST_LIMIT_USD = 0.05;
const LATEST_TURN_CACHE_WRITE_TOKEN_LIMIT_RATIO = 0.4;
const PRESERVED_TAIL_BUDGET_RATIO = 0.4;
const PRESERVED_TURN_TARGETS = [5, 3, 1] as const;
const CHARS_PER_TOKEN_ESTIMATE = 4;

export type CompactResult = {
  messages: AgentMessage[];
  didCompact: boolean;
  reason: string;
};

export async function compact(
  messages: AgentMessage[],
  {
    signal,
    model: modelEntry,
    instructions,
    force,
  }: {
    signal?: AbortSignal;
    model: { model: Model<Api>; key: string };
    instructions?: string;
    force?: boolean;
  }
): Promise<CompactResult> {
  const effectiveSignal = signal ?? new AbortController().signal;

  if (force) {
    return doCompact('Forced');
  }

  if (effectiveSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const currentUsage = usage(messages);
  const contextWindow =
    currentUsage.tokens.window > 0
      ? currentUsage.tokens.window
      : modelEntry.model.contextWindow;

  const softLimit =
    currentUsage.tokens.limit > 0
      ? currentUsage.tokens.limit
      : Math.floor(contextWindow * CONTEXT_SOFT_LIMIT_RATIO);
  const latestTurnTokenLimit = Math.floor(
    contextWindow * LATEST_TURN_CACHE_WRITE_TOKEN_LIMIT_RATIO
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
    latestTurnCacheWriteCost >= LATEST_TURN_CACHE_WRITE_COST_LIMIT_USD
  ) {
    const trigger = `Cache write cost $${latestTurnCacheWriteCost.toFixed(4)} exceeded $${LATEST_TURN_CACHE_WRITE_COST_LIMIT_USD.toFixed(2)} threshold`;
    logger.info(trigger);
    return doCompact(trigger);
  }

  if (latestTurnCacheWriteTokens >= latestTurnTokenLimit) {
    const trigger = `Cache write tokens ${latestTurnCacheWriteTokens} exceeded ${latestTurnTokenLimit} token threshold`;
    logger.info(trigger);
    return doCompact(trigger);
  }

  if (currentTokens <= softLimit) {
    const reason = `Context is within budget (${currentTokens}/${softLimit} tokens, ${Math.round((currentTokens / softLimit) * 100)}%)`;
    logger.info(reason);
    return { messages, didCompact: false, reason };
  }

  const trigger = `Context ${currentTokens} tokens exceeded ${softLimit} soft limit`;
  logger.info(trigger);

  return doCompact(trigger);

  async function doCompact(trigger: string): Promise<CompactResult> {
    const hasUserMessages = messages.some((msg) => msg.role === 'user');
    if (!hasUserMessages) {
      const reason = 'No user messages found';
      logger.info(reason);
      return { messages, didCompact: false, reason };
    }

    const tailBudget = computeTailBudget();
    const splitIndex = findBestSplitIndex(tailBudget);

    if (splitIndex === null || splitIndex <= 0) {
      const reason = 'Preserved tail already covers the full conversation';
      logger.info(reason);
      return { messages, didCompact: false, reason };
    }

    const preserve = messages.slice(splitIndex);
    const messagesToCompact = messages.slice(0, splitIndex);

    const compactedMessages = await summarize(messagesToCompact, {
      model: modelEntry,
      signal: effectiveSignal,
      instructions,
    });

    return {
      messages: [...compactedMessages, ...preserve],
      didCompact: true,
      reason: trigger,
    };
  }

  function computeTailBudget(): number {
    const contextWindow = modelEntry.model.contextWindow ?? 0;

    if (contextWindow <= 0) {
      return Infinity;
    }

    return Math.floor(contextWindow * PRESERVED_TAIL_BUDGET_RATIO);
  }

  function findBestSplitIndex(tailBudget: number): number | null {
    for (const turnTarget of PRESERVED_TURN_TARGETS) {
      const startIndex = findPreservedTailStartIndex(turnTarget);
      if (startIndex === null || startIndex <= 0) continue;

      const tail = messages.slice(startIndex);
      if (estimateTokens(tail) <= tailBudget) {
        return startIndex;
      }
    }

    // All turn-based splits exceed the budget; fall back to a
    // token-bounded suffix that fits within the budget.
    return findTokenBoundedSplitIndex(tailBudget);
  }

  function findPreservedTailStartIndex(
    preservedUserMessages: number
  ): number | null {
    let userMessagesSeen = 0;
    let earliestUserMessageIndex: number | null = null;

    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const message = messages[messageIndex];
      if (message.role === 'user') {
        earliestUserMessageIndex = messageIndex;
        userMessagesSeen += 1;
        if (userMessagesSeen === preservedUserMessages) {
          return messageIndex;
        }
      }
    }

    return earliestUserMessageIndex;
  }

  function findTokenBoundedSplitIndex(tailBudget: number): number | null {
    let runningTokens = 0;

    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      runningTokens += estimateMessageTokens(messages[messageIndex]);

      if (runningTokens > tailBudget) {
        const splitIndex = messageIndex + 1;
        if (splitIndex >= messages.length) {
          return null;
        }
        return splitIndex;
      }
    }

    return null;
  }
}

function estimateTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

function estimateMessageTokens(message: AgentMessage): number {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE);
  }
  if (Array.isArray(content)) {
    let charCount = 0;
    for (const block of content) {
      const text = (block as { text?: string }).text;
      if (typeof text === 'string') {
        charCount += text.length;
      }
    }
    return Math.ceil(charCount / CHARS_PER_TOKEN_ESTIMATE);
  }
  return 0;
}
