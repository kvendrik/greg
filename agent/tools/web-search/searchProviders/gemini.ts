import { GoogleGenAI } from '@google/genai';
import { AgentToolResult } from '@mariozechner/pi-agent-core';

const SEARCH_TIMEOUT_MS = 10_000;

export async function searchWithGemini(
  apiKey: string,
  query: string,
  signal?: AbortSignal
): Promise<AgentToolResult<object>> {
  const ai = new GoogleGenAI({ apiKey });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
        abortSignal: controller.signal,
      },
    });

    const answer = response.text ?? '';
    const chunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    const citations = chunks
      .map((chunk) => ({
        title: chunk.web?.title ?? '',
        url: chunk.web?.uri ?? '',
      }))
      .filter((c) => Boolean(c.title && c.url));

    const citationsSummary =
      citations.length === 0
        ? ''
        : '\n\nSources:\n' +
          citations.map((c) => `- ${c.title} (${c.url})`).join('\n');

    return {
      content: [{ type: 'text' as const, text: answer + citationsSummary }],
      details: {},
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}
