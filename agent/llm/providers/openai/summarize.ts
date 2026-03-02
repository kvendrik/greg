import type { SummarizeResult } from '../types';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import OpenAI from 'openai';
import config from '../../../../.config';

const openai = new OpenAI({ apiKey: config.providers.openai.key });

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
    const messages = params.messages as ChatCompletionMessageParam[];
    const apiMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SUMMARIZE_SYSTEM },
      ...messages.filter((msg) => msg.role !== 'system'),
    ];

    const completion = await openai.chat.completions.create({
      model: params.model,
      max_tokens: 4096,
      messages: apiMessages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'summarize_result',
          strict: true,
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

    const content = completion.choices[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    const result = parseSummarizeResponse(text);
    if (!result) {
      console.error('[openai/summarize] invalid or empty JSON');
      return null;
    }
    return result;
  } catch (err) {
    console.error('[openai/summarize] failed:', err);
    return null;
  }
}
