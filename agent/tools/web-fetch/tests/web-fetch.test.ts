import { describe, expect, it } from 'bun:test';
import type { AgentConfig } from '../../../types';
import { createWebFetchTool } from '../web-fetch';

function createConfig(overrides?: Partial<AgentConfig['tools']>): AgentConfig {
  return {
    id: 'test',
    workspace: '/tmp/test',
    models: [],
    tools: {
      guard: { enabled: true },
      ...overrides,
    },
  } as AgentConfig;
}

describe('web-fetch', () => {
  describe('createWebFetchTool()', () => {
    it('returns tool with name web_fetch and url param', () => {
      const tool = createWebFetchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      expect(tool.name).toBe('web_fetch');
      const schema = tool.parameters as { properties?: { url?: unknown } };
      expect(schema.properties?.url).toBeDefined();
    });

    it('throws on invalid URL', async () => {
      const tool = createWebFetchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      await expect(
        tool.execute!('id', { url: 'not-a-url' }, undefined)
      ).rejects.toThrow(/Invalid URL/);
    });

    it('throws AbortError when signal is already aborted', async () => {
      const tool = createWebFetchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      const controller = new AbortController();
      controller.abort();
      await expect(
        tool.execute!('id', { url: 'https://example.com/' }, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('returns blocked message for localhost (SSRF)', async () => {
      const tool = createWebFetchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      const result = await tool.execute!(
        'id',
        { url: 'http://localhost:8080/page' },
        undefined
      );
      expect((result.content[0] as { text: string }).text).toBe(
        'Blocked for security reasons.'
      );
      expect(result.details).toMatchObject({ success: false });
    });

    it('returns blocked message for 127.0.0.1 (SSRF)', async () => {
      const tool = createWebFetchTool({
        config: createConfig(),
        onBackgroundUpdate: () => {},
      });
      const result = await tool.execute!(
        'id',
        { url: 'http://127.0.0.1/page' },
        undefined
      );
      expect((result.content[0] as { text: string }).text).toBe(
        'Blocked for security reasons.'
      );
    });

    it('returns title and content when fetch returns HTML and guard is disabled', async () => {
      const html = `<!DOCTYPE html><html><head><title>Test Page</title></head><body><article><h1>Hello</h1><p>Body text here.</p></article></body></html>`;
      const requestUrl = 'https://example.com/page';
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof globalThis.fetch }).fetch = (async (
        input: RequestInfo | URL
      ) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.startsWith('https://example.com/')) {
          const res = new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
          Object.defineProperty(res, 'url', {
            value: requestUrl,
            writable: false,
          });
          return res;
        }
        return originalFetch.call(globalThis, input);
      }) as typeof globalThis.fetch;
      try {
        const tool = createWebFetchTool({
          config: createConfig(), // no guard
          onBackgroundUpdate: () => {},
        });
        const result = await tool.execute!(
          'id',
          { url: requestUrl },
          undefined
        );
        expect((result.content[0] as { text: string }).text).toContain('Hello');
        expect((result.content[0] as { text: string }).text).toContain(
          'Body text here'
        );
        expect(result.details).toMatchObject({
          url: requestUrl,
          title: 'Test Page',
        });
      } finally {
        (globalThis as { fetch: typeof globalThis.fetch }).fetch =
          originalFetch;
      }
    });

    it('returns graceful message when fetch fails with connection error', async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof globalThis.fetch }).fetch = (async (
        input: RequestInfo | URL
      ) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.startsWith('https://example.com/')) {
          const err = new Error('fetch failed') as NodeJS.ErrnoException;
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return originalFetch.call(globalThis, input);
      }) as typeof globalThis.fetch;
      try {
        const tool = createWebFetchTool({
          config: createConfig(),
          onBackgroundUpdate: () => {},
        });
        const result = await tool.execute!(
          'id',
          { url: 'https://example.com/page' },
          undefined
        );
        expect((result.content[0] as { text: string }).text).toContain(
          'Page could not be loaded'
        );
        expect(result.details).toMatchObject({ success: false });
      } finally {
        (globalThis as { fetch: typeof globalThis.fetch }).fetch =
          originalFetch;
      }
    });
  });
});
