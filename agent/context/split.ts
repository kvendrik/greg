import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { SUMMARY_PREFIX } from './summarize';

/** Max share of the context window the preserved tail may occupy. Keeps
 *  room for the summary and new turns after compaction. */
const PRESERVED_TAIL_BUDGET_RATIO = 0.4;

/** User-turn counts to try preserving, highest first. We greedily keep as
 *  much recent context as the budget allows, falling back to fewer turns. */
const PRESERVED_TURN_TARGETS = [5, 3, 1] as const;

/** Rough chars-per-token ratio for the fallback heuristic. Only used for
 *  user messages; assistant messages use their API-reported token count. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function split(
  messages: AgentMessage[],
  model: Model<Api>,
): {
  compact: AgentMessage[] | null;
  preserve: AgentMessage[];
} {
  const hasUserMessages = messages.some((msg) => msg.role === 'user');

  if (!hasUserMessages) {
    return { compact: null, preserve: messages };
  }

  const tailBudget = computeTailBudget();
  const splitIndex = findBestSplitIndex(tailBudget);

  if (splitIndex === null || splitIndex <= 0) {
    return { compact: null, preserve: messages };
  }

  const compactSlice = messages.slice(0, splitIndex);
  const preserveSlice = messages.slice(splitIndex);

  // Never re-summarize existing summaries — move them to preserve.
  const summaries = compactSlice.filter(isSummaryMessage);
  const toCompact = compactSlice.filter((m) => !isSummaryMessage(m));

  if (toCompact.length === 0) {
    return { compact: null, preserve: messages };
  }

  return {
    compact: toCompact,
    preserve: [...summaries, ...preserveSlice],
  };

  function findBestSplitIndex(budget: number): number | null {
    for (const turnTarget of PRESERVED_TURN_TARGETS) {
      const startIndex = findPreservedTailStartIndex(turnTarget);
      if (startIndex === null || startIndex <= 0) {
        continue;
      }

      const tail = messages.slice(startIndex);
      if (estimateTokens(tail) <= budget) {
        return startIndex;
      }
    }

    return findTokenBoundedSplitIndex(budget);
  }

  function findPreservedTailStartIndex(
    preservedUserMessages: number,
  ): number | null {
    let userMessagesSeen = 0;
    let earliestUserMessageIndex: number | null = null;

    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const message = messages[messageIndex];
      if (message?.role === 'user') {
        earliestUserMessageIndex = messageIndex;
        userMessagesSeen += 1;
        if (userMessagesSeen === preservedUserMessages) {
          return messageIndex;
        }
      }
    }

    return earliestUserMessageIndex;
  }

  function findTokenBoundedSplitIndex(budget: number): number | null {
    let runningTokens = 0;

    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const msg = messages[messageIndex];
      if (msg === undefined) {
        continue;
      }
      runningTokens += estimateMessageTokens(msg);

      if (runningTokens > budget) {
        const candidateIndex = messageIndex + 1;
        if (candidateIndex >= messages.length) {
          return null;
        }
        return candidateIndex;
      }
    }

    return null;
  }

  function computeTailBudget(): number {
    const contextWindow = model.contextWindow;

    if (contextWindow <= 0) {
      return Infinity;
    }

    return Math.floor(contextWindow * PRESERVED_TAIL_BUDGET_RATIO);
  }
}

function isSummaryMessage(message: AgentMessage | undefined): boolean {
  if (message === undefined) {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' && content.startsWith(SUMMARY_PREFIX);
}

function estimateTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

function estimateMessageTokens(message: AgentMessage): number {
  // Prefer API-reported output token count for assistant messages.
  const msgUsage = message as { role?: string; usage?: { output?: number } };
  if (
    msgUsage.role === 'assistant' &&
    typeof msgUsage.usage?.output === 'number' &&
    msgUsage.usage.output > 0
  ) {
    return msgUsage.usage.output;
  }

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
