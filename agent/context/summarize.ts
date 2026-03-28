import { completeSimple } from '@mariozechner/pi-ai';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { createLogger } from '../../utilities/logger';

const logger = createLogger('Summarize');

const SUMMARIZE_SYSTEM = `You are a summarizer. Given a conversation history, produce a concise summary that preserves key facts, decisions, topics, and context needed to continue the conversation. Output only the summary, no preamble.`;

export const SUMMARY_PREFIX = '[Compaction summary]\n\n';

export async function summarize(
  messages: AgentMessage[],
  {
    model,
    signal,
    instructions,
  }: {
    model: { model: Model<Api>; key: string };
    signal: AbortSignal;
    instructions?: string;
  }
): Promise<AgentMessage[]> {
  logger.info(
    `Compacting ${messages.length} messages using ${model.model.name}...`
  );

  const transcript = messagesToTranscript(messages);

  const response = await completeSimple(
    model.model,
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
    { signal, apiKey: model.key }
  );

  const summaryText = extractTextFromAssistantMessage(response).trim();

  if (!summaryText) {
    throw new Error('Compaction failed: model returned no summary.');
  }

  const summaryMessage: AgentMessage = {
    role: 'user',
    content: `${SUMMARY_PREFIX}${summaryText}`,
    timestamp: Date.now(),
  };

  logger.info(`Compaction done...`);

  return [summaryMessage];
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

