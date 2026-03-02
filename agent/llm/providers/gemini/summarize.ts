import type { SummarizeResult } from '../types';
import { GoogleGenAI } from '@google/genai';
import config from '../../../../.config';

const ai = new GoogleGenAI({ apiKey: config.providers.gemini.key });

const SUMMARIZE_SYSTEM = `You are summarizing a long conversation so the assistant can continue in a new context.

- "note": A concise note for the conversation log (tasks, topics, decisions; not durable user facts). Will be saved via save_conversation_note.
- "condensed_summary": A short summary (a few paragraphs) so the assistant can continue the chat naturally. Include the main topics, any in-progress tasks, and the last few exchanges.

Respond with valid JSON only: {"note": "...", "condensed_summary": "..."}`;

function parseSummarizeResponse(text: string): SummarizeResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const jsonStr = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
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
    const contents = params.messages as Array<{ role: string; parts: unknown[] }>;
    const response = await ai.models.generateContent({
      model: params.model,
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '(no messages)' }] }],
      config: {
        systemInstruction: SUMMARIZE_SYSTEM,
        maxOutputTokens: 4096,
      },
    });

    const text = response.text ?? '';
    const result = parseSummarizeResponse(text);
    if (!result) {
      console.error('[gemini/summarize] invalid or empty JSON');
      return null;
    }
    return result;
  } catch (err) {
    console.error('[gemini/summarize] failed:', err);
    return null;
  }
}
