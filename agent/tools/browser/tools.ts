import { execFileSync } from 'child_process';
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
    name: 'fetch_web_page',
    description: 'Open a web page',
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
  handler: async ({ url }) => {
    try {
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
        .turndown(
          execFileSync('curl', ['-L', '--', url], {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
          })
        )
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
      'Get interactive element IDs on a web page URL. Use with interact_with_web_page.',
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
  handler: async ({ url }) => {
    try {
      const client = await getCDPClient();
      await client.Page.enable();
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
    name: 'interact_with_web_page',
    description:
      'Click on a specific element on the current web page. Use the id from snapshot_web_page.',
    input_schema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'number',
          description:
            'The id of the element to click on (from get_web_page_elements)',
        },
      },
    },
  },
  handler: async ({ id }) => {
    const elementIndex = Math.floor(Number(id));
    if (elementIndex < 0 || !Number.isFinite(id)) {
      return { content: `Invalid element id: ${id}` };
    }

    try {
      const client = await getCDPClient();
      const result = await client.Runtime.evaluate({
        expression: `
          (function() {
            var els = document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)});
            var el = els[${elementIndex}];
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
          content: `Error clicking element [${elementIndex}]: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
        };
      }

      if (typeof result.result?.value === 'string') {
        try {
          if (!(JSON.parse(result.result.value) as { ok: boolean }).ok) {
            return { content: `Element [${elementIndex}] not found` };
          }
        } catch {
          return {
            content: `Element [${elementIndex}] click result invalid`,
          };
        }
      }

      return { content: `Clicked on element [${elementIndex}]` };
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
          var roleAttr = role ? ' role="' + role + '"' : '';
          return { tag: tag, text: text, typeAttr: typeAttr, roleAttr: roleAttr };
        }));
      })()
    `,
      returnByValue: true,
    })
  ).result?.value;

  if (typeof raw !== 'string') return '';

  try {
    const items = JSON.parse(raw) as Array<{
      tag: string;
      text: string;
      typeAttr: string;
      roleAttr?: string;
    }>;
    return items
      .map((item, i) => {
        const label = item.text || '(no text)';
        const type = `${item.tag}${item.typeAttr ? ` type="${item.typeAttr}"` : ''} ${item.roleAttr ? ` role="${item.roleAttr}"` : ''}`;
        return `[${i}] "${label}" <${type} />`;
      })
      .join('\n');
  } catch {
    throw new Error('Failed to parse interactive elements');
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
