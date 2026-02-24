import { Anthropic } from '@anthropic-ai/sdk';
import type {
  MessageParam,
  MessageCountTokensParams,
} from '@anthropic-ai/sdk/resources/messages';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { saveConversationNote } from './tools/memory';

export interface PrepareMessagesOpts {
  system: string;
  messages: MessageParam[];
  newUserContent: string;
  tools: BetaRunnableTool[];
  conversationStartIso: string;
}

export const MODEL = 'claude-sonnet-4-20250514';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function prepareMessages(
  opts: PrepareMessagesOpts
): Promise<MessageParam[]> {
  const messages: MessageParam[] = [
    ...opts.messages,
    { role: 'user', content: opts.newUserContent },
  ];

  if (messages.length <= 1) return messages;

  const { input_tokens } = await anthropic.messages.countTokens({
    model: MODEL,
    system: opts.system,
    messages,
    tools: opts.tools as MessageCountTokensParams['tools'],
  });

  if (input_tokens < 0 || input_tokens < 150_000) {
    return messages;
  }

  const summarized = await summarizeConversation(messages);
  if (!summarized) return messages;

  try {
    await saveConversationNote(summarized.note, opts.conversationStartIso);
  } catch (err) {
    console.error('[context] saveConversationNote failed:', err);
    // Continue with condensed messages so the conversation doesn't stall
  }

  const condensedUserMessage: MessageParam = {
    role: 'user',
    content: `${summarized.condensed_summary}\n\n---\nUser's latest message:\n\n${opts.newUserContent}`,
  };

  return [condensedUserMessage];
}

type SummarizeResult = { note: string; condensed_summary: string } | null;

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

/**
 * Ask the model to summarize the conversation into a note and a condensed summary.
 * Returns null on parse failure or invalid response.
 */
async function summarizeConversation(
  messages: MessageParam[]
): Promise<SummarizeResult> {
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: `You are summarizing a long conversation so the assistant can continue in a new context.

- "note": A concise note for the conversation log (tasks, topics, decisions; not durable user facts). Will be saved via save_conversation_note.
- "condensed_summary": A short summary (a few paragraphs) so the assistant can continue the chat naturally. Include the main topics, any in-progress tasks, and the last few exchanges.`,
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
      console.error('[context] summarizeConversation: invalid or empty JSON');
      return null;
    }
    return result;
  } catch (err) {
    console.error('[context] summarizeConversation failed:', err);
    return null;
  }
}
