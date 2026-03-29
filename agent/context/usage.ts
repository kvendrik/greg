import {
  getModels,
  getProviders,
  type KnownProvider,
  type Usage,
} from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

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

function hasUsage(msg: AgentMessage | undefined): msg is MessageWithUsage {
  return (
    (msg as { role?: string }).role === 'assistant' &&
    typeof (msg as { usage?: Usage }).usage?.input === 'number'
  );
}

function getContextTokensFromUsage(msgUsage: UsageWithCost): number {
  return msgUsage.input + msgUsage.cacheRead + msgUsage.cacheWrite;
}

function hasMeaningfulUsage(msgUsage: UsageWithCost): boolean {
  return (
    msgUsage.input > 0 ||
    msgUsage.output > 0 ||
    msgUsage.cacheRead > 0 ||
    msgUsage.cacheWrite > 0 ||
    msgUsage.totalTokens > 0 ||
    (typeof msgUsage.cost === 'object' && msgUsage.cost.total > 0)
  );
}


function getLatestAssistantMessageWithUsage(
  messages: AgentMessage[],
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
  messages: AgentMessage[],
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
    },
  );
}

function getContextWindowFromMessage(message: MessageWithUsage | null): number {
  if (message === null) {
    return 0;
  }

  const knownProvider = getProviders().find(
    (provider): provider is KnownProvider => provider === message.provider,
  );

  if (knownProvider === undefined) {
    return 0;
  }

  const model = getModels(knownProvider).find(
    (candidate) =>
      candidate.name === message.model || candidate.id === message.model,
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
      const contextTokens = getContextTokensFromUsage(message.usage);
      if (contextTokens > 0) {
        return contextTokens;
      }
    }
  }

  if (sawAssistantUsage) {
    return 0;
  }

  throw new Error(
    'Cannot derive context tokens: no assistant message with provider usage found.',
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
  };
  cost: Cost & {
    /** Total cost charged across all assistant turns in the session, in USD. */
    session: Cost;
  };
}

const ZERO_COST: Cost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

function buildCostStats(
  latestCost: Cost | undefined,
  sessionCost: Cost,
): ContextUsage['cost'] {
  const base = latestCost ?? ZERO_COST;
  return { ...base, session: sessionCost };
}

export function usage(messages: AgentMessage[]): ContextUsage {
  const latestMessage = getLatestAssistantMessageWithUsage(messages);
  const latestDisplayMessage =
    getLatestAssistantMessageWithMeaningfulUsage(messages) ?? latestMessage;
  const displayUsage = latestDisplayMessage?.usage ?? null;
  const latestCost =
    latestDisplayMessage === null ? undefined : latestDisplayMessage.usage.cost;
  const sessionCost = getSessionCostTotals(messages);
  const usedTokens = deriveContextTokens(messages);
  const contextWindow = getContextWindowFromMessage(latestMessage);

  return {
    tokens: {
      input: displayUsage?.input ?? 0,
      output: displayUsage?.output ?? 0,
      cacheRead: displayUsage?.cacheRead ?? 0,
      cacheWrite: displayUsage?.cacheWrite ?? 0,
      used: usedTokens,
      window: contextWindow,
      percentageWindow:
        contextWindow === 0
          ? 0
          : Math.min(100, (usedTokens / contextWindow) * 100),
    },
    cost: buildCostStats(latestCost, sessionCost),
  };
}
