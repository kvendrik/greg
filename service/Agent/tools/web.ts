import { GoogleGenAI } from '@google/genai';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { Type } from '@sinclair/typebox';
import type { AgentConfig } from '../types';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { available as isGuardAvailable, isSafe } from './utilities/guard/guard';

export interface Citation {
  title: string;
  url: string;
}

export interface WebSearchResult {
  answer: string;
  citations: Citation[];
}

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}

function createWebFetchTool(config: AgentConfig): AgentTool {
  return {
    name: 'web_fetch',
    label: 'web fetch',
    description: `Fetch and read the content of a specific web page URL, returning clean readable text.
Use this when you have a specific URL and need to read its contents — for example to
read documentation, an article, or a page linked from search results. Does not execute
JavaScript, so it works best on server-rendered pages (articles, docs, blogs).
For JS-heavy sites or pages behind login, this may return incomplete content.
Returns { url: string, title: string, content: string, truncated: boolean }`,

    parameters: Type.Object({
      url: Type.String({
        description: 'Absolute HTTP or HTTPS URL of the page to fetch.',
      }),
    }),

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { url: urlInput } = params as { url: string };

      let url: string;
      try {
        url = new URL(urlInput).toString();
      } catch {
        throw new Error(`Invalid URL: ${urlInput}`);
      }

      const response = await guardedFetch(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; web-fetch/1.0)',
            Accept: 'text/html,application/xhtml+xml',
          },
        },
        signal
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} for ${url}`
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('text/plain')
      ) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let capped = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          chunks.push(
            value.slice(0, value.byteLength - (totalBytes - MAX_RESPONSE_BYTES))
          );
          capped = true;
          break;
        }
        chunks.push(value);
      }

      if (capped) reader.cancel();

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const html = new TextDecoder().decode(combined);

      const finalUrl = response.url ?? url;
      const { title, content } = extractContent(html, finalUrl);

      const truncated = capped || content.length > MAX_CHARS;
      const trimmedContent =
        content.length > MAX_CHARS
          ? content.slice(0, MAX_CHARS) + '\n\n[truncated]'
          : content;

      const details: WebFetchResult = {
        url: finalUrl,
        title,
        content: trimmedContent,
        truncated,
      };

      let finalContent =
        (details.title ? `${details.title}\n\n` : '') + details.content;

      const host = new URL(finalUrl).host;
      const hostOptions =
        config.tools.guard?.allowlist?.webFetch?.[host] ?? null;

      if ((await isGuardAvailable(config)) && !hostOptions?.trusted) {
        const result = await isSafe(config, content, {
          name: host,
          use: config.tools.guard?.use ?? 'all',
        });

        if (!result.safe) {
          finalContent = result.message;
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: finalContent,
          },
        ],
        details: {
          url: finalUrl,
          title,
          truncated,
        },
      };
    },
  };
}

function getWebSearchTool(config: AgentConfig): AgentTool | null {
  if (!config.tools.webSearch?.geminiKey) {
    return null;
  }

  const ai = new GoogleGenAI({ apiKey: config.tools.webSearch.geminiKey });

  return {
    name: 'web_search',
    label: 'web search',
    description: `Search the web for real-time information using Google Search grounding via Gemini.
Use this tool when the user asks about current events, today's weather, live sports
scores, recent news, stock prices, or any information that may have changed since
your knowledge cutoff. Returns an AI-synthesized answer with citations grounded in
live Google Search results. Only call this when the query clearly requires up-to-date
information that would not be in your training data.
Returns { answer: string, citations: { title: string, url: string }[] }`,

    parameters: Type.Object({
      query: Type.String({
        description: 'Natural language web search query.',
      }),
    }),

    async execute(_id, params, signal) {
      const { query } = params as { query: string };

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
          tools: [{ googleSearch: {} }],
          abortSignal: signal,
        },
      });

      const answer = response.text ?? '';
      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

      const citations: Citation[] = chunks
        .map((chunk) => ({
          title: chunk.web?.title ?? '',
          url: chunk.web?.uri ?? '',
        }))
        .filter((c): c is Citation => Boolean(c.title && c.url));

      const details: WebSearchResult = { answer, citations };

      const citationsSummary =
        citations.length === 0
          ? ''
          : '\n\nSources:\n' +
            citations.map((c) => `- ${c.title} (${c.url})`).join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: answer + citationsSummary,
          },
        ],
        details,
      };
    },
  };
}

export function getWebTools(config: AgentConfig): AgentTool[] {
  const webSearchTool = getWebSearchTool(config);
  return [
    createWebFetchTool(config),
    ...(webSearchTool ? [webSearchTool] : []),
  ];
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  'metadata.google.internal',
]);

const PRIVATE_IPV4_RANGES = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^169\.254\./, // link-local / AWS metadata
  /^0\./, // this network
];

function isPrivateIPv4(address: string): boolean {
  return PRIVATE_IPV4_RANGES.some((re) => re.test(address));
}

function isPrivateIPv6(address: string): boolean {
  const lower = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fec0:')) return true;
  const ipv4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (ipv4Tail) return isPrivateIPv4(ipv4Tail[1]);
  return false;
}

class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

async function checkSsrf(url: URL): Promise<void> {
  const { hostname } = url;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Blocked scheme: ${url.protocol}`);
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfBlockedError(`Blocked hostname: ${hostname}`);
  }

  if (/^[\d.]+$/.test(hostname) && isPrivateIPv4(hostname)) {
    throw new SsrfBlockedError(`Blocked private IPv4: ${hostname}`);
  }

  if (hostname.includes(':') && isPrivateIPv6(hostname)) {
    throw new SsrfBlockedError(`Blocked private IPv6: ${hostname}`);
  }
}

async function guardedFetch(
  urlString: string,
  options: RequestInit = {},
  signal?: AbortSignal,
  maxRedirects = 5
): Promise<Response> {
  let current = urlString;
  let hops = 0;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Timeout', 'AbortError'));
  }, FETCH_TIMEOUT_MS);

  const onAbort = () => {
    controller.abort(new DOMException('Aborted', 'AbortError'));
  };

  if (signal?.aborted) {
    clearTimeout(timeoutId);
    throw new DOMException('Aborted', 'AbortError');
  }

  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (hops <= maxRedirects) {
      const url = new URL(current);
      await checkSsrf(url);

      const response = await fetch(current, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect with no Location header');
        current = new URL(location, current).toString();
        hops++;
        continue;
      }

      return response;
    }

    throw new Error(`Too many redirects (max ${maxRedirects})`);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CHARS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

function extractContent(
  html: string,
  url: string
): { title: string; content: string } {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article?.content) {
    const markdown = NodeHtmlMarkdown.translate(article.content);
    return {
      title: article.title ?? '',
      content: markdown,
    };
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { title: '', content: text };
}
