import { completeSimple } from '@mariozechner/pi-ai';
import type { Usage } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentConfig } from './types';
import { createLogger } from '../utilities/logger';

const logger = createLogger('Compact');

const SUMMARIZE_SYSTEM = `You are a summarizer. Given a conversation history, produce a concise summary that preserves key facts, decisions, topics, and context needed to continue the conversation. Output only the summary, no preamble.`;

type MessageWithUsage = AgentMessage & (Usage & { role: 'assistant' });

function hasUsage(msg: AgentMessage): msg is MessageWithUsage {
  return (
    (msg as { role?: string }).role === 'assistant' &&
    typeof (msg as { usage?: Usage }).usage?.input === 'number'
  );
}

/**
 * Context size in tokens based solely on provider‑reported usage.
 *
 * We take the last assistant message that has a `usage` field and interpret
 * its context size as:
 *
 *   input tokens + cache read tokens + cache write tokens
 *
 * This matches the tokens the provider actually saw as prompt/cache at the
 * time of that call. Messages after that point are *not* estimated.
 */
export function deriveContextTokens(messages: AgentMessage[]): number {
  if (messages.filter(({ role }) => role === 'assistant').length === 0) {
    return 0;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (hasUsage(messages[i])) {
      const u = (messages[i] as { usage: Usage }).usage;
      return u.input + u.cacheRead + u.cacheWrite;
    }
  }

  throw new Error(
    'Cannot derive context tokens: no assistant message with provider usage found.'
  );
}

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
            b &&
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
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('');
}

export async function compactContext(
  messages: AgentMessage[],
  signal: AbortSignal | undefined,
  config: AgentConfig
): Promise<{ messages: AgentMessage[]; didCompact: boolean }> {
  const effectiveSignal = signal ?? new AbortController().signal;

  if (effectiveSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const model = config.models.find((model) => model.role === 'primary')!.model;
  const contextWindow = model?.contextWindow ?? 128_000;

  // compaction can take a long time so the soft limit is 60% of the context window
  // so that it's faster. better to do it in chunks.
  const softLimit = Math.floor(contextWindow * 0.6);
  const currentTokens = deriveContextTokens(messages);

  if (currentTokens <= softLimit) {
    logger.info(
      `Current context size: ${currentTokens}/${softLimit} tokens (${Math.round((currentTokens / softLimit) * 100)}%)`
    );
    return { messages, didCompact: false };
  }

  logger.info(
    `Current context size ${currentTokens} tokens above ${softLimit} tokens`
  );

  const lastMessage = messages[messages.length - 1];
  const allWithoutLastMessage = messages.slice(0, -1);

  const compactedMessages = await compact(allWithoutLastMessage, {
    config,
    signal: effectiveSignal,
  });

  return { messages: [...compactedMessages, lastMessage], didCompact: true };
}

export async function compact(
  messages: AgentMessage[],
  { config, signal }: { config: AgentConfig; signal: AbortSignal }
): Promise<AgentMessage[]> {
  const model = config.models.find((model) => model.role === 'primary')!.model;

  logger.info(`Compacting ${messages.length} messages using ${model.name}...`);

  const transcript = messagesToTranscript(messages);
  const apiKey = getApiKey(model.provider, config);

  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZE_SYSTEM,
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
