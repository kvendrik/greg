import type { WebSearchSuccessDetails } from '../types';

const BRAVE_WEB_SEARCH_ENDPOINT =
  'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const REQUEST_TIMEOUT_MS = 30_000;

const FRESHNESS_TO_BRAVE: Record<string, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
  pd: 'pd',
  pw: 'pw',
  pm: 'pm',
  py: 'py',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export interface BraveSearchOptions {
  count?: number;
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  freshness?: string;
  date_after?: string;
  date_before?: string;
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveWebSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

function resolveBraveFreshness(opts: BraveSearchOptions): string | undefined {
  if (opts.date_after && opts.date_before) {
    const after = opts.date_after.trim();
    const before = opts.date_before.trim();
    if (isValidIsoDate(after) && isValidIsoDate(before) && after <= before) {
      return `${after}to${before}`;
    }
  }
  if (opts.freshness) {
    const key = opts.freshness.trim().toLowerCase();
    return FRESHNESS_TO_BRAVE[key];
  }
  return undefined;
}

export async function searchWithBrave(
  apiKey: string,
  query: string,
  signal?: AbortSignal,
  options?: BraveSearchOptions
): Promise<WebSearchSuccessDetails> {
  const count = Math.min(
    MAX_COUNT,
    Math.max(1, options?.count ?? DEFAULT_COUNT)
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
  const onAbort = () => { controller.abort(); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));

    if (options?.country?.trim()) {
      url.searchParams.set('country', options.country.trim());
    }
    if (options?.search_lang?.trim()) {
      url.searchParams.set('search_lang', options.search_lang.trim());
    }
    if (options?.ui_lang?.trim()) {
      url.searchParams.set('ui_lang', options.ui_lang.trim());
    }
    const freshness = resolveBraveFreshness(options ?? {});
    if (freshness) {
      url.searchParams.set('freshness', freshness);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Subscription-Token': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Brave Search API error (${response.status}): ${body || response.statusText}`
      );
    }

    const data = (await response.json()) as BraveWebSearchResponse;
    const results = data.web?.results ?? [];

    const citations = results
      .filter((r): r is BraveWebResult & { title: string; url: string } =>
        Boolean(r.title && r.url)
      )
      .map((r) => ({ title: r.title, url: r.url }));

    const answer =
      results.length === 0
        ? 'No results found.'
        : results.length === 1
          ? (results[0].description ?? results[0].title ?? 'One result found.')
          : `${results.length} results. Use web_fetch with a citation url to read a page in full.`;

    return { answer, citations };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}
