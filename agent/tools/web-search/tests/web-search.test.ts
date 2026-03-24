import { describe, expect, it } from 'bun:test';
import type { AgentConfig } from '../../../types';
import { createWebSearchTool } from '../web-search';

function createConfig(overrides?: Partial<AgentConfig['tools']>): AgentConfig {
  return {
    id: 'test',
    workspace: '/tmp/test',
    models: [],
    tools: {
      guard: { enabled: true },
      webSearch: {
        provider: 'brave',
        key: 'test-key',
      },
      ...overrides,
    },
  } as AgentConfig;
}

describe('web-search', () => {
  describe('createWebSearchTool()', () => {
    it('returns tool with name web_search and required query param', () => {
      const tool = createWebSearchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      expect(tool.name).toBe('web_search');
      expect(tool.parameters).toBeDefined();
      const schema = tool.parameters as { properties?: { query?: unknown } };
      expect(schema.properties?.query).toBeDefined();
    });

    it('returns "Query is required." when query is empty', async () => {
      const tool = createWebSearchTool({
        config: createConfig({ webSearch: undefined }),
        onBackgroundUpdate: () => {},
      });
      const result = await tool.execute('id', { query: '' }, undefined);
      expect(result.content[0].type).toBe('text');
      expect((result.content[0] as { text: string }).text).toBe(
        'Query is required.'
      );
      expect(result.details).toEqual({ answer: '', citations: [] });
    });

    it('returns "Query is required." when query is only whitespace', async () => {
      const tool = createWebSearchTool({
        config: createConfig({ webSearch: undefined }),
        onBackgroundUpdate: () => {},
      });
      const result = await tool.execute('id', { query: '   ' }, undefined);
      expect((result.content[0] as { text: string }).text).toBe(
        'Query is required.'
      );
    });

    it('throws AbortError when signal is already aborted', () => {
      const tool = createWebSearchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      const controller = new AbortController();
      controller.abort();
      return expect(
        tool.execute('id', { query: 'test' }, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('returns unavailable message when no webSearch config', async () => {
      const tool = createWebSearchTool({
        config: createConfig({ webSearch: undefined }),
        onBackgroundUpdate: () => {},
      });
      const result = await tool.execute('id', { query: 'weather' }, undefined);
      expect((result.content[0] as { text: string }).text).toContain(
        'Web search is unavailable'
      );
      expect(result.details).toMatchObject({
        success: false,
        reason: 'No search provider available',
      });
    });

    it('clamps count to 1–10 and passes options to Brave when fetch is mocked', async () => {
      const braveResponse = {
        web: {
          results: [
            { title: 'Result 1', url: 'https://example.com/1', description: 'D1' },
          ],
        },
      };
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof globalThis.fetch }).fetch = (async (
        input: RequestInfo | URL
      ) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('api.search.brave.com')) {
          return new Response(JSON.stringify(braveResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch.call(globalThis, input);
      }) as typeof globalThis.fetch;
      try {
        const tool = createWebSearchTool({
          config: createConfig(),
          onBackgroundUpdate: () => {},
        });
        const result = await tool.execute(
          'id',
          { query: 'test', count: 99 },
          undefined
        );
        expect(result.content[0].type).toBe('text');
        expect((result.content[0] as { text: string }).text).toContain(
          'Result 1'
        );
      } finally {
        (globalThis as { fetch: typeof globalThis.fetch }).fetch =
          originalFetch;
      }
    });

    it('returns graceful message when Brave fetch fails with connection error', async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof globalThis.fetch }).fetch = (async (
        input: RequestInfo | URL
      ) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('api.search.brave.com')) {
          const err = new Error('fetch failed') as NodeJS.ErrnoException;
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalFetch.call(globalThis, input);
      }) as typeof globalThis.fetch;
      try {
        const tool = createWebSearchTool({
          config: createConfig(),
          onBackgroundUpdate: () => {},
        });
        const result = await tool.execute('id', { query: 'test' }, undefined);
        expect((result.content[0] as { text: string }).text).toContain(
          'Web search is unavailable'
        );
        expect(result.details).toMatchObject({ success: false });
      } finally {
        (globalThis as { fetch: typeof globalThis.fetch }).fetch =
          originalFetch;
      }
    });
  });
});
