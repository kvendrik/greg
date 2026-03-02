import type { SummarizeResult } from '../types';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { Anthropic } from '@anthropic-ai/sdk';
import config from '../../../../.config';

const anthropic = new Anthropic({ apiKey: config.providers.anthropic.key });

const SUMMARIZE_SYSTEM = `You are summarizing a long conversation so the assistant can continue in a new context.

- "note": A concise note for the conversation log (tasks, topics, decisions; not durable user facts). Will be saved via save_conversation_note.
- "condensed_summary": A short summary (a few paragraphs) so the assistant can continue the chat naturally. Include the main topics, any in-progress tasks, and the last few exchanges.`;

function parseSummarizeResponse(text: string): SummarizeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    !('note' in parsed) ||
    !('condensed_summary' in parsed)
  ) {
    return null;
  }
  const note = String((parsed as { note: unknown }).note).trim();
  const condensed_summary = String(
    (parsed as { condensed_summary: unknown }).condensed_summary
  ).trim();
  if (!note || !condensed_summary) return null;
  return { note, condensed_summary };
}

export async function summarize(params: {
  system: string;
  messages: unknown;
  model: string;
}): Promise<SummarizeResult> {
  try {
    const messages = params.messages as MessageParam[];
    const message = await anthropic.messages.create({
      model: params.model,
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: SUMMARIZE_SYSTEM,
      messages,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              note: {
                type: 'string',
                description: 'Concise note for the conversation log',
              },
              condensed_summary: {
                type: 'string',
                description: 'Short summary so the assistant can continue',
              },
            },
            required: ['note', 'condensed_summary'],
            additionalProperties: false,
          },
        },
      },
    });

    const content = message.content ?? [];
    const textBlock = content.find((b) => b.type === 'text');
    const text = textBlock && 'text' in textBlock ? String(textBlock.text) : '';
    const result = parseSummarizeResponse(text);
    if (!result) {
      console.error('[anthropic/summarize] invalid or empty JSON');
      return null;
    }
    return result;
  } catch (err) {
    console.error('[anthropic/summarize] failed:', err);
    return null;
  }
}
