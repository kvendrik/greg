import { getModels, getProviders } from '@mariozechner/pi-ai';
import type { KnownProvider, Usage } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { CONTEXT_SOFT_LIMIT_RATIO } from './compact';

type UsageWithCost = Usage & {
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

type MessageWithUsage = AgentMessage & {
  role: 'assistant';
  provider: string;
  model: string;
  usage: UsageWithCost;
};

function hasUsage(msg: AgentMessage): msg is MessageWithUsage {
  return (
    (msg as { role?: string }).role === 'assistant' &&
    typeof (msg as { usage?: Usage }).usage?.input === 'number'
  );
}

function getContextTokensFromUsage(usage: UsageWithCost): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

function hasMeaningfulUsage(usage: UsageWithCost): boolean {
  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.totalTokens > 0 ||
    (typeof usage.cost === 'object' && usage.cost.total > 0)
  );
}

export function getLatestAssistantUsage(
  messages: AgentMessage[]
): UsageWithCost | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (hasUsage(message)) {
      return message.usage;
    }
  }

  return null;
}

function getLatestAssistantMessageWithUsage(
  messages: AgentMessage[]
): MessageWithUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (hasUsage(message)) {
      return message;
    }
  }

  return null;
}

function getLatestAssistantMessageWithMeaningfulUsage(
  messages: AgentMessage[]
): MessageWithUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (hasUsage(message) && hasMeaningfulUsage(message.usage)) {
      return message;
    }
  }

  return null;
}

function getSessionCostTotals(messages: AgentMessage[]): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
} {
  return messages.reduce(
    (sessionCost, message) => {
      if (!hasUsage(message) || typeof message.usage.cost !== 'object') {
        return sessionCost;
      }

      return {
        input: sessionCost.input + message.usage.cost.input,
        output: sessionCost.output + message.usage.cost.output,
        cacheRead: sessionCost.cacheRead + message.usage.cost.cacheRead,
        cacheWrite: sessionCost.cacheWrite + message.usage.cost.cacheWrite,
        total: sessionCost.total + message.usage.cost.total,
      };
    },
    {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    }
  );
}

function getContextWindowFromMessage(message: MessageWithUsage | null): number {
  if (message === null) {
    return 0;
  }

  const knownProvider = getProviders().find(
    (provider): provider is KnownProvider => provider === message.provider
  );

  if (knownProvider === undefined) {
    return 0;
  }

  const model = getModels(knownProvider).find(
    (candidate) =>
      candidate.name === message.model || candidate.id === message.model
  );

  return model?.contextWindow ?? 0;
}

function deriveContextTokens(messages: AgentMessage[]): number {
  if (messages.filter(({ role }) => role === 'assistant').length === 0) {
    return 0;
  }

  let sawAssistantUsage = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (hasUsage(message)) {
      sawAssistantUsage = true;
      const usage = message.usage;
      const contextTokens = getContextTokensFromUsage(usage);
      if (contextTokens > 0) {
        return contextTokens;
      }
    }
  }

  if (sawAssistantUsage) {
    return 0;
  }

  throw new Error(
    'Cannot derive context tokens: no assistant message with provider usage found.'
  );
}

interface Cost {
  /** Input token cost charged for the latest assistant turn, in USD. */
  input: number;
  /** Output token cost charged for the latest assistant turn, in USD. */
  output: number;
  /** Cached prompt read cost charged for the latest assistant turn, in USD. */
  cacheRead: number;
  /** Cached prompt write cost charged for the latest assistant turn, in USD. */
  cacheWrite: number;
  /** Total cost charged for the latest assistant turn, in USD. */
  total: number;
}

interface ContextUsage {
  tokens: {
    /** Latest assistant turn input tokens. */
    input: number;
    /** Latest assistant turn output tokens. */
    output: number;
    /** Latest assistant turn cached prompt read tokens. */
    cacheRead: number;
    /** Latest assistant turn cached prompt write tokens. */
    cacheWrite: number;
    /** Context tokens attributed to the latest assistant turn. */
    used: number;
    /** Maximum context window for the resolved model, or `0` when unknown. */
    window: number;
    /** Percent of the context window currently used, clamped to `100`. */
    percentageWindow: number;
    /** Soft compaction threshold derived from the context window. */
    limit: number;
    /** Percent of the soft compaction threshold currently used, clamped to `100`. */
    percentageLimit: number;
  };
  cost: Cost & {
    /** Total cost charged across all assistant turns in the session, in USD. */
    session: Cost;
  };
}

export function usage(messages: AgentMessage[]): ContextUsage {
  const latestMessage = getLatestAssistantMessageWithUsage(messages);
  const latestDisplayMessage =
    getLatestAssistantMessageWithMeaningfulUsage(messages) ?? latestMessage;
  const latestCost =
    latestDisplayMessage === null ? undefined : latestDisplayMessage.usage.cost;
  const sessionCost = getSessionCostTotals(messages);
  const usedTokens = deriveContextTokens(messages);
  const contextWindow = getContextWindowFromMessage(latestMessage);
  const softLimit = Math.floor(contextWindow * CONTEXT_SOFT_LIMIT_RATIO);

  return {
    tokens: {
      input: latestDisplayMessage?.usage.input ?? 0,
      output: latestDisplayMessage?.usage.output ?? 0,
      cacheRead: latestDisplayMessage?.usage.cacheRead ?? 0,
      cacheWrite: latestDisplayMessage?.usage.cacheWrite ?? 0,
      used: usedTokens,
      window: contextWindow,
      percentageWindow:
        contextWindow === 0
          ? 0
          : Math.min(100, (usedTokens / contextWindow) * 100),
      limit: softLimit,
      percentageLimit: Math.min(100, (usedTokens / softLimit) * 100),
    },
    cost: {
      input: latestCost?.input ?? 0,
      output: latestCost?.output ?? 0,
      cacheRead: latestCost?.cacheRead ?? 0,
      cacheWrite: latestCost?.cacheWrite ?? 0,
      total: latestCost?.total ?? 0,
      session: sessionCost,
    },
  };
}
