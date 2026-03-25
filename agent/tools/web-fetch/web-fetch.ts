import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { Type } from '@sinclair/typebox';
import type { ToolContext } from '../../types';
import type { AgentTool } from '@mariozechner/pi-agent-core';

export function createWebFetchTool(_context: ToolContext): AgentTool {
  return {
    name: 'web_fetch',
    label: 'web fetch',
    description: `Fetch and read the content of a specific web page URL, returning clean readable text.
Use when you have a URL (e.g. from web_search citations) and need the full page — documentation, articles, or any result link. Does not execute JavaScript; best for server-rendered pages (articles, docs, blogs). For JS-heavy or login-only pages, content may be incomplete.
By default uses Mozilla Readability to isolate the main article; if the result looks like the wrong fragment (e.g. only nav labels, UI chrome, or a few words), call again with use_readability false to use the full visible body text instead (noisier but complete).
Returns { url: string, title: string, content: string, truncated: boolean }`,

    parameters: Type.Object({
      url: Type.String({
        description: 'Absolute HTTP or HTTPS URL of the page to fetch.',
      }),
      use_readability: Type.Optional(
        Type.Boolean({
          description:
            'When true (default), extract main content with Readability. Set false if the first result looks wrong (novelty layouts, heavy UI) to use normalized full body text instead.',
        })
      ),
    }),

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { url: urlInput, use_readability: useReadabilityParam } =
        params as {
          url: string;
          use_readability: boolean | undefined;
        };
      const useReadability = useReadabilityParam !== false;

      let url: string;
      try {
        url = new URL(urlInput).toString();
      } catch {
        throw new Error(`Invalid URL: ${urlInput}`);
      }

      try {
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

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            chunks.push(
              value.slice(
                0,
                value.byteLength - (totalBytes - MAX_RESPONSE_BYTES)
              )
            );
            capped = true;
            break;
          }
          chunks.push(value);
        }

        if (capped) void reader.cancel();

        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        const html = new TextDecoder().decode(combined);

        const finalUrl = response.url;
        const { title, content } = extractContent(html, finalUrl, {
          useReadability,
        });

        const truncated = capped || content.length > MAX_CHARS;
        const trimmedContent =
          content.length > MAX_CHARS
            ? content.slice(0, MAX_CHARS) + '\n\n[truncated]'
            : content;

        const details = {
          url: finalUrl,
          title,
          content: trimmedContent,
          truncated,
        };

        const finalContent =
          (details.title ? `${details.title}\n\n` : '') + details.content;

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
      } catch (err) {
        if (isAbortError(err)) throw err;
        if (
          err instanceof SsrfBlockedError ||
          isConnectionOrTimeoutError(err)
        ) {
          const message = failureMessage(err);
          return {
            content: [{ type: 'text' as const, text: message }],
            details: { success: false, reason: message },
          };
        }
        throw err;
      }
    },
  };
}

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

function failureMessage(err: unknown): string {
  if (err instanceof SsrfBlockedError) return 'Blocked for security reasons.';
  if (!(err instanceof Error))
    return 'Page could not be loaded. Service unreachable.';
  if (err.message.toLowerCase().includes('timeout'))
    return 'Page could not be loaded. Request timed out.';
  return 'Page could not be loaded. Service unreachable.';
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

function checkSsrf(url: URL): void {
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

  const onAbort = (): void => {
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
      checkSsrf(url);

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
  url: string,
  options: { useReadability: boolean }
): { title: string; content: string } {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  if (!options.useReadability) {
    const titleEl = doc.querySelector('title');
    const titleFromHead = (titleEl?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const rawBody = doc.body.textContent;
    const content = rawBody.replace(/\s+/g, ' ').trim();
    if (content.length > 0) {
      return { title: titleFromHead, content };
    }
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return { title: titleFromHead, content: text };
  }

  const reader = new Readability(doc);
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
