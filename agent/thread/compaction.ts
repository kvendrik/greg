import { completeSimple } from '@mariozechner/pi-ai';
import type { Usage } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import config from '../../.greg';

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
  signal?: AbortSignal
): Promise<AgentMessage[]> {
  const effectiveSignal = signal ?? new AbortController().signal;
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

  if (effectiveSignal.aborted) {
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
    { signal: effectiveSignal, apiKey }
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
