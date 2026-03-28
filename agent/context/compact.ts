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

export interface CompactResult {
  messages: AgentMessage[];
  didCompact: boolean;
  reason: string;
}

interface CompactOptions {
  signal?: AbortSignal;
  model: { model: Model<Api>; key: string };
  instructions?: string;
  force?: boolean;
}

export class Compact {
  constructor(private model: { model: Model<Api>; key: string }) {}

  checkLimit(messages: AgentMessage[]): {
    reached: boolean;
    reason: string;
  } {
    return reachedLimit(messages, this.model.model);
  }

  split(messages: AgentMessage[]): {
    compact: AgentMessage[] | null;
    preserve: AgentMessage[];
  } {
    return split(messages, this.model.model);
  }

  summarize(
    messages: AgentMessage[],
    {
      signal,
      instructions,
    }: {
      signal: AbortSignal;
      instructions?: string;
    }
  ): Promise<AgentMessage[]> {
    return summarize(messages, {
      model: this.model,
      signal,
      instructions,
    });
  }
}

export async function compact(
  messages: AgentMessage[],
  { signal, model: modelEntry, instructions, force }: CompactOptions
): Promise<CompactResult> {
  const effectiveSignal = signal ?? new AbortController().signal;

  if (force) {
    return doCompact('Forced');
  }

  if (effectiveSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const { reached, reason } = reachedLimit(messages, modelEntry.model);
  logger.info(reason);

  if (!reached) {
    return { messages, didCompact: false, reason };
  }

  return doCompact(reason);

  async function doCompact(trigger: string): Promise<CompactResult> {
    const { compact: messagesToCompact, preserve } = split(
      messages,
      modelEntry.model
    );

    if (messagesToCompact === null) {
      return { messages, didCompact: false, reason: trigger };
    }

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
}

function split(
  messages: AgentMessage[],
  model: Model<Api>
): {
  compact: AgentMessage[] | null;
  preserve: AgentMessage[];
} {
  const hasUserMessages = messages.some((msg) => msg.role === 'user');

  if (!hasUserMessages) {
    const reason = 'No user messages found';
    logger.info(reason);
    return { compact: null, preserve: messages };
  }

  const tailBudget = computeTailBudget();
  const splitIndex = findBestSplitIndex(tailBudget);

  if (splitIndex === null || splitIndex <= 0) {
    const reason = 'Preserved tail already covers the full conversation';
    logger.info(reason);
    return { compact: null, preserve: messages };
  }

  return {
    compact: messages.slice(0, splitIndex),
    preserve: messages.slice(splitIndex),
  };

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

  function computeTailBudget(): number {
    const contextWindow = model.contextWindow ?? 0;

    if (contextWindow <= 0) {
      return Infinity;
    }

    return Math.floor(contextWindow * PRESERVED_TAIL_BUDGET_RATIO);
  }
}

function reachedLimit(
  messages: AgentMessage[],
  model: Model<Api>
): { reached: boolean; reason: string } {
  const currentUsage = usage(messages);
  const contextWindow =
    currentUsage.tokens.window > 0
      ? currentUsage.tokens.window
      : model.contextWindow;

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
    const reason = `Cache write cost $${latestTurnCacheWriteCost.toFixed(4)} exceeded $${LATEST_TURN_CACHE_WRITE_COST_LIMIT_USD.toFixed(2)} threshold`;
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
  return { reached: false, reason };
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
