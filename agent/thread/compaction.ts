import { completeSimple } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import config from '../../.greg';

const SUMMARIZE_SYSTEM = `You are a summarizer. Given a conversation history, produce a concise summary that preserves key facts, decisions, topics, and context needed to continue the conversation. Output only the summary, no preamble.`;

/** Fallback when no provider usage is available. Uses ~4 chars/token for English. */
function estimateTokensFromChars(messages: AgentMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    const content = (m as { content?: string | Array<{ text?: string }> })
      .content;
    if (!content) continue;
    if (typeof content === 'string') {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          'text' in block &&
          typeof block.text === 'string'
        ) {
          chars += block.text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

type MessageWithUsage = AgentMessage & {
  role: 'assistant';
  usage: { input: number; cacheRead?: number; cacheWrite?: number };
};

function hasUsage(msg: AgentMessage): msg is MessageWithUsage {
  return (
    (msg as { role?: string }).role === 'assistant' &&
    typeof (msg as MessageWithUsage).usage?.input === 'number'
  );
}

/**
 * Context size in tokens. Uses provider-reported usage when available (last
 * assistant message's input + cache tokens). Otherwise
 * falls back to char-based estimate.
 */
export function deriveContextTokens(messages: AgentMessage[]): number {
  if (messages.length === 0) return 0;
  let lastUsageIndex = -1;
  let lastInputTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (hasUsage(messages[i])) {
      lastUsageIndex = i;
      const u = (messages[i] as MessageWithUsage).usage;
 lastInputTokens = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      break;
    }
  }
  if (lastUsageIndex < 0) {
    return estimateTokensFromChars(messages);
  }
  const messagesAfterUsage = messages.slice(lastUsageIndex + 1);
  const estimatedNew = estimateTokensFromChars(messagesAfterUsage);
  return lastInputTokens + estimatedNew;
}

function messagesToTranscript(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const msg = m as {
      role: string;
      content?: string | Array<{ type?: string; text?: string }>;
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
  content?: Array<{ type?: string; text?: string }>;
}): string {
  const content = msg.content ?? [];
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('');
}

export async function compactContext(
  messages: AgentMessage[],
  signal: AbortSignal
): Promise<AgentMessage[]> {
  const model = config.models.find((model) => model.role === 'primary')!.model;
  const getApiKey = (provider: string) => {
    const key =
      config.models.find((model) => model.model.provider === provider)?.key ??
      null;
    if (!key) {
      throw new Error(
        `No API key found for provider "${provider}" in config.models.`
      );
    }
    return key;
  };

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const contextWindow = model?.contextWindow ?? 128_000;
  const softLimit = Math.floor(contextWindow * 0.8);
  const targetAfterCompact = Math.floor(contextWindow * 0.6);

  const currentTokens = deriveContextTokens(messages);
  if (currentTokens <= softLimit) {
    return messages;
  }

  let splitIndex = messages.length;
  for (let i = 0; i < messages.length; i++) {
    const recent = messages.slice(i);
    if (deriveContextTokens(recent) <= targetAfterCompact) {
      splitIndex = i;
      break;
    }
  }

  const toSummarize = messages.slice(0, splitIndex);
  const recent = messages.slice(splitIndex);
  if (toSummarize.length === 0) {
    return recent;
  }

  const transcript = messagesToTranscript(toSummarize);
  const apiKey = getApiKey(model.provider);
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

  return [summaryMessage, ...recent];
}
