import { Type } from '@sinclair/typebox';
import type { ToolContext } from '../../types';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { searchWithGemini } from './searchProviders/gemini';
import { searchWithBrave } from './searchProviders/brave';
export type { WebFetchResult, WebSearchSuccessDetails } from './types';
import type { WebSearchSuccessDetails } from './types';

const WEB_SEARCH_COUNT_MIN = 1;
const WEB_SEARCH_COUNT_MAX = 10;
const WEB_SEARCH_COUNT_DEFAULT = 5;

const CONNECTION_ERROR_CODES = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
];

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isConnectionOrTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code =
    'code' in err
      ? (err as NodeJS.ErrnoException).code
      : err.cause instanceof Error && 'code' in err.cause
        ? (err.cause as NodeJS.ErrnoException).code
        : undefined;
  const message = err.message;
  return (
    CONNECTION_ERROR_CODES.includes(code ?? '') ||
    /unable to connect|fetch failed|connection refused|network|econnrefused|enotfound|etimedout|econnreset|timeout/i.test(
      message
    )
  );
}

function reasonFromError(err: unknown): string {
  if (!(err instanceof Error)) return 'Service unreachable';
  if (err.message.toLowerCase().includes('timeout')) return 'Request timed out';
  return 'Service unreachable';
}

export function createWebSearchTool({ config }: ToolContext): AgentTool {
  return {
    name: 'web_search',
    label: 'web search',
    description: `Search the web for real-time information (Brave or Gemini).
Use when the user asks about current events, weather, sports, news, stock prices, or anything that may have changed.
Parameters: query (required), optional count (1-10), country (2-letter), language, freshness (day/week/month/year), date_after/date_before (YYYY-MM-DD).
Returns { answer: string, citations: { title: string, url: string }[] }. When you need the full content of a result, call web_fetch with that citation's url.`,

    parameters: Type.Object({
      query: Type.String({
        description: 'Search query string.',
      }),
      count: Type.Optional(
        Type.Number({
          description: 'Number of results to return (1-10).',
          minimum: WEB_SEARCH_COUNT_MIN,
          maximum: WEB_SEARCH_COUNT_MAX,
        })
      ),
      country: Type.Optional(
        Type.String({
          description:
            '2-letter country code for region-specific results (e.g. DE, US).',
        })
      ),
      language: Type.Optional(
        Type.String({
          description:
            'Language code for results (e.g. en, de, fr). Maps to Brave search_lang when using Brave.',
        })
      ),
      freshness: Type.Optional(
        Type.String({
          description:
            "Filter by time: 'day' (24h), 'week', 'month', or 'year'.",
        })
      ),
      date_after: Type.Optional(
        Type.String({
          description: 'Only results published after this date (YYYY-MM-DD).',
        })
      ),
      date_before: Type.Optional(
        Type.String({
          description: 'Only results published before this date (YYYY-MM-DD).',
        })
      ),
    }),

    async execute(_id, params, signal) {
      const raw = params as {
        query: string;
        count?: number;
        country?: string;
        language?: string;
        freshness?: string;
        date_after?: string;
        date_before?: string;
      };

      const query = raw.query?.trim();
      if (!query) {
        return {
          content: [{ type: 'text' as const, text: 'Query is required.' }],
          details: { answer: '', citations: [] },
        };
      }

      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const count =
        typeof raw.count === 'number' && Number.isFinite(raw.count)
          ? Math.max(
              WEB_SEARCH_COUNT_MIN,
              Math.min(WEB_SEARCH_COUNT_MAX, Math.floor(raw.count))
            )
          : WEB_SEARCH_COUNT_DEFAULT;

      const braveOptions = {
        count,
        country: raw.country?.trim() || undefined,
        search_lang: raw.language?.trim() || undefined,
        freshness: raw.freshness?.trim() || undefined,
        date_after: raw.date_after?.trim() || undefined,
        date_before: raw.date_before?.trim() || undefined,
      };

      let result: WebSearchSuccessDetails | null = null;
      let lastFailureReason: string | null = null;

      if (config.tools?.webSearch?.provider === 'brave') {
        try {
          result = await searchWithBrave(
            config.tools?.webSearch.key,
            query,
            signal,
            braveOptions
          );
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (isConnectionOrTimeoutError(err)) {
            lastFailureReason = reasonFromError(err);
          } else {
            throw err;
          }
        }
      }

      if (config.tools?.webSearch?.provider === 'gemini') {
        try {
          result = await searchWithGemini(
            config.tools?.webSearch.key,
            query,
            signal
          );
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (isConnectionOrTimeoutError(err)) {
            lastFailureReason = reasonFromError(err);
          } else {
            throw err;
          }
        }
      }

      if (result) {
        const citationsSummary =
          result.citations.length === 0
            ? ''
            : '\n\nSources:\n' +
              result.citations.map((c) => `- ${c.title} (${c.url})`).join('\n');

        const parsedResult = `${result.answer}${citationsSummary}`;

        return {
          content: [{ type: 'text' as const, text: parsedResult }],
          details: {
            success: true,
            answer: result.answer,
            citations: result.citations,
          },
        };
      }

      const message =
        lastFailureReason != null
          ? `Web search is unavailable. ${lastFailureReason}.`
          : 'Web search is unavailable right now.';

      return {
        content: [{ type: 'text' as const, text: message }],
        details: {
          success: false,
          reason: lastFailureReason ?? 'No search provider available',
        },
      };
    },
  };
}
