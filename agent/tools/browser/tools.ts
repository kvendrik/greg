import TurndownService from 'turndown';
import type { Tool } from '../types';
import { getCDPClient, type CDPClient } from './chrome';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getWebPageContentTool: Tool<{ url: string }> = {
  spec: {
    name: 'read_web_page',
    description: 'Read the contents for the page that is currently open as Markdown',
    input_schema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the web page to open',
        },
      },
    },
  },
  handler: async () => {
    try {
      const client = await getCDPClient();
      
      const htmlResult = await client.Runtime.evaluate({
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      });

      if (htmlResult.exceptionDetails) {
        return {
          content: `Error reading page content: ${htmlResult.exceptionDetails.exception?.description ?? htmlResult.exceptionDetails.text}`,
        };
      }

      const html = typeof htmlResult.result?.value === 'string' 
        ? htmlResult.result.value 
        : '';

      const service = new TurndownService();

      service.addRule('stripImg', { filter: 'img', replacement: () => '' });

      service.addRule('stripStyle', {
        filter: 'style',
        replacement: () => '',
      });

      service.addRule('stripScript', {
        filter: 'script',
        replacement: () => '',
      });

      const content = service
        .turndown(html)
        .replace(/\s+/g, ' ');

      return {
        content,
      };
    } catch (error) {
      return { content: `Error fetching web page: ${formatError(error)}` };
    }
  },
};

const getWebPageElementsTool: Tool<{ url: string }> = {
  spec: {
    name: 'snapshot_web_page',
    description:
      'Open web page and get interactive element IDs. Use with click_on_web_page_element for navigation and read_web_page to read the page’s contents as Markdown.',
    input_schema: {
      type: 'object',
      required: [],
      properties: {},
    },
  },
  handler: async ({ url }) => {
    try {
      const client = await getCDPClient();
      await client.Page.enable();
      await client.Network.enable();
      const loadTimeoutMs = 10_000;
      const loadDone = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Load timeout')),
          loadTimeoutMs
        );
        client.Page.loadEventFired(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      await client.Page.navigate({ url });
      await loadDone;
      await waitForNetworkIdle(client, 500, 5_000);
      return { content: await getInteractiveElements(client) };
    } catch (error) {
      return {
        content: `Error getting web page content: ${formatError(error)}`,
      };
    }
  },
};

const clickOnWebPageElementTool: Tool<{ id: number }> = {
  spec: {
    name: 'click_on_web_page_element',
    description:
      'Click on a specific element on the current web page. Use the id from snapshot_web_page.',
    input_schema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description:
            'The id of the element to click on (from get_web_page_elements)',
        },
      },
    },
  },
  handler: async ({ id }) => {
    try {
      const client = await getCDPClient();
      const result = await client.Runtime.evaluate({
        expression: `
          (function() {
            var els = document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)});
            var el = [...els].find(el => el.getAttribute('data-agent-id') === "${id}");
            if (!el) return JSON.stringify({ ok: false, error: 'not found' });
            el.scrollIntoView({ block: 'center' });
            el.click();
            return JSON.stringify({ ok: true });
          })()
        `,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        return {
          content: `Error clicking element [${id}]: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
        };
      }

      if (typeof result.result?.value === 'string') {
        try {
          if (!(JSON.parse(result.result.value) as { ok: boolean }).ok) {
            return { content: `Element [${id}] not found` };
          }
        } catch {
          return {
            content: `Element [${id}] click result invalid`,
          };
        }
      }

      return { content: `Clicked on element [${id}]` };
    } catch (error) {
      return {
        content: `Error interacting with web page: ${formatError(error)}`,
      };
    }
  },
};

export const tools = [
  getWebPageContentTool,
  clickOnWebPageElementTool,
  getWebPageElementsTool,
];

/**
 * Wait until no new network requests have been sent for `idleMs`, so that
 * in-flight XHR/fetch and their JS callbacks have time to complete.
 * Resolves after at most `maxWaitMs` to avoid hanging on polling pages.
 */
function waitForNetworkIdle(
  client: CDPClient,
  idleMs: number,
  maxWaitMs: number
): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const maybeResolve = () => {
      if (idleTimer) clearTimeout(idleTimer);
      resolve();
    };

    const onRequest = () => {
      if (Date.now() - start >= maxWaitMs) return maybeResolve();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(maybeResolve, idleMs);
    };

    client.Network.requestWillBeSent(onRequest);
    idleTimer = setTimeout(maybeResolve, idleMs);
    setTimeout(maybeResolve, maxWaitMs);
  });
}

async function getInteractiveElements(client: CDPClient): Promise<string> {
  const raw = (
    await client.Runtime.evaluate({
      expression: `
      (function() {
        var selector = ${JSON.stringify(INTERACTIVE_SELECTOR)};
        var els = document.querySelectorAll(selector);
        var allowedTag = { A: 1, BUTTON: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1 };
        var allowedRole = { button: 1, link: 1, checkbox: 1, menuitem: 1 };
        return JSON.stringify(Array.from(els).filter(function(e) {
          if (allowedTag[e.tagName]) return true;
          var role = (e.getAttribute('role') || '').toLowerCase();
          return allowedRole[role];
        }).map(function(e) {
          var tag = e.tagName.toLowerCase();
          var role = (e.getAttribute('role') || '');
          var text = (e.textContent || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
          var typeAttr = tag === 'input' ? (e.getAttribute('type') || 'text') : '';
          e.setAttribute('data-agent-id', Math.random().toString(36).substring(2, 15));
          return { id: e.getAttribute('data-agent-id'), tag: tag, text: text, typeAttr: typeAttr, roleAttr: role };
        }));
      })()
    `,
      returnByValue: true,
    })
  ).result?.value;

  console.log(raw);

  if (typeof raw !== 'string') return '';

  try {
    const items = JSON.parse(raw) as Array<{
      id: string;
      tag: string;
      text: string;
      typeAttr: string;
      roleAttr?: string;
    }>;
    return items
      .map((item, i) => {
        const label = item.text || '(no text)';
        const type = `${item.tag}${item.typeAttr ? ` type="${item.typeAttr}"` : ''} ${item.roleAttr ? `role="${item.roleAttr}"` : ''}`;
        return `[${item.id}] "${label}" <${type} />`;
      })
      .join('\n');
  } catch {
    throw new Error('Failed to parse interactive elements');
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
