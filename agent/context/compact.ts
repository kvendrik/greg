import { completeSimple } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentConfig } from '../types';
import { createLogger } from '../../utilities/logger';
import {
  CONTEXT_SOFT_LIMIT_RATIO,
  getLatestAssistantUsage,
  usage,
} from './usage';

const logger = createLogger('Compact');

const SUMMARIZE_SYSTEM = `You are a summarizer. Given a conversation history, produce a concise summary that preserves key facts, decisions, topics, and context needed to continue the conversation. Output only the summary, no preamble.`;

const LATEST_TURN_CACHE_WRITE_COST_LIMIT_USD = 0.05;
const LATEST_TURN_CACHE_WRITE_TOKEN_LIMIT_RATIO = 0.4;

function messagesToTranscript(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const msg = m as {
      role: string;
      content?: string | { type?: string; text?: string }[];
    };
    const content = msg.content;
    if (!content) continue;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter(
          (b) =>
            (b as { type?: string }).type === 'text' &&
            typeof (b as { text?: string }).text === 'string'
        )
        .map((b) => (b as { text: string }).text)
        .join('');
    }
    if (text.trim()) lines.push(`${msg.role}: ${text.trim()}`);
  }
  return lines.join('\n\n');
}

function extractTextFromAssistantMessage(msg: {
  content?: { type?: string; text?: string }[];
}): string {
  const content = msg.content ?? [];
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        b.type === 'text' && typeof b.text === 'string'
    )
    .map((b) => b.text)
    .join('');
}

export async function compact(
  messages: AgentMessage[],
  {
    signal,
    config,
    instructions,
    force,
  }: {
    signal?: AbortSignal;
    config: AgentConfig;
    instructions?: string;
    force?: boolean;
  }
): Promise<{ messages: AgentMessage[]; didCompact: boolean }> {
  const effectiveSignal = signal ?? new AbortController().signal;

  if (force) {
    return doCompact();
  }

  if (effectiveSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const primaryEntry = config.models.find((model) => model.role === 'primary');
  if (!primaryEntry) {
    throw new Error('No primary model in config.models.');
  }
  const model = primaryEntry.model;
  const currentUsage = usage(messages);
  const contextWindow =
    currentUsage.tokens.window > 0
      ? currentUsage.tokens.window
      : model.contextWindow;

  // compaction can take a long time so the soft limit is 60% of the context window
  // so that it's faster. better to do it in chunks.
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
    logger.info(
      `Latest turn cache write cost $${latestTurnCacheWriteCost.toFixed(4)} above $${LATEST_TURN_CACHE_WRITE_COST_LIMIT_USD.toFixed(2)} threshold`
    );
    return doCompact();
  }

  if (latestTurnCacheWriteTokens >= latestTurnTokenLimit) {
    logger.info(
      `Latest turn cache write tokens ${latestTurnCacheWriteTokens} above ${latestTurnTokenLimit} token threshold`
    );
    return doCompact();
  }

  if (currentTokens <= softLimit) {
    logger.info(
      `Current context size: ${currentTokens}/${softLimit} tokens (${Math.round((currentTokens / softLimit) * 100)}%)`
    );
    return { messages, didCompact: false };
  }

  logger.info(
    `Current context size ${currentTokens} tokens above ${softLimit} tokens`
  );

  return doCompact();

  async function doCompact(): Promise<{
    messages: AgentMessage[];
    didCompact: boolean;
  }> {
    const preserveStartIndex = findPreservedTailStartIndex(5);

    if (preserveStartIndex === null) {
      logger.info('Skipping compaction because no user messages were found.');
      return { messages, didCompact: false };
    }

    if (preserveStartIndex <= 0) {
      logger.info(
        'Skipping compaction because the preserved tail already covers the full conversation.'
      );
      return { messages, didCompact: false };
    }

    const preserve = messages.slice(preserveStartIndex);
    const messagesToCompact = messages.slice(0, preserveStartIndex);

    const compactedMessages = await summarize(messagesToCompact, {
      config,
      signal: effectiveSignal,
      instructions,
    });

    return {
      messages: [...compactedMessages, ...preserve],
      didCompact: true,
    };
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
}

async function summarize(
  messages: AgentMessage[],
  {
    config,
    signal,
    instructions,
  }: { config: AgentConfig; signal: AbortSignal; instructions?: string }
): Promise<AgentMessage[]> {
  const primaryEntry = config.models.find((model) => model.role === 'primary');
  if (!primaryEntry) {
    throw new Error('No primary model in config.models.');
  }
  const model = primaryEntry.model;

  logger.info(`Compacting ${messages.length} messages using ${model.name}...`);

  const transcript = messagesToTranscript(messages);
  const apiKey = getApiKey(model.provider, config);

  const response = await completeSimple(
    model,
    {
      systemPrompt:
        SUMMARIZE_SYSTEM +
        (instructions ? `\n\nAdditional instructions: ${instructions}` : ''),
      messages: [
        {
          role: 'user',
          content: transcript,
          timestamp: Date.now(),
        },
      ],
    },
    { signal, apiKey }
  );

  const summaryText = extractTextFromAssistantMessage(response).trim();

  if (!summaryText) {
    throw new Error('Compaction failed: model returned no summary.');
  }

  const summaryMessage: AgentMessage = {
    role: 'user',
    content: `[Previous conversation summary]\n\n${summaryText}`,
    timestamp: Date.now(),
  };

  logger.info(`Compaction done...`);

  return [summaryMessage];
}

function getApiKey(provider: string, config: AgentConfig): string {
  const key =
    config.models.find((model) => model.model.provider === provider)?.key ??
    null;

  if (!key) {
    throw new Error(
      `No API key found for provider "${provider}" in config.models.`
    );
  }

  return key;
}
