import playwright from 'playwright';
import type { Tool } from './types';
import { convert } from '@kreuzberg/html-to-markdown-node';

interface State {
  browser: playwright.Browser | null;
  context: playwright.BrowserContext | null;
  page: playwright.Page | null;
}

export async function create(): Promise<{ state: State; tools: Tool<any>[] }> {
  const state: State = {
    browser: null,
    context: null,
    page: null,
  };

  const getWebPageContentTool: Tool<{ url: string }> = {
    spec: {
      type: 'function',
      function: {
        name: 'open_web_page',
        description: 'Open a web page',
        parameters: {
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
    },
    handler: async ({ url }) => {
      state.browser =
        state.browser ??
        (await playwright.chromium.launch({
          headless: false,
          channel: 'chrome',
        }));
      state.context = state.context ?? (await state.browser.newContext());
      state.page = state.page ?? (await state.context.newPage());

      try {
        await state.page.goto(url, {
          waitUntil: 'load',
        });
        await state.page.waitForLoadState('networkidle');

        const content = await state.page.content();
        const markdown = convert(content, {
          skipImages: true,
        });

        return { content: markdown };
      } catch (error) {
        return { content: 'Error getting web page content: ' + error };
      }
    },
  };

  const getWebPageElementsTool: Tool<{ selector: string }> = {
    spec: {
      type: 'function',
      function: {
        name: 'get_web_page_elements',
        description: 'Get all interactive elements on the current web page',
      },
    },
    handler: async () => {
      const elements = await getInteractiveElements(state.page);
      console.log(elements);
      return { content: elements };
    },
  };

  const clickOnWebPageElementTool: Tool<{ id: number }> = {
    spec: {
      type: 'function',
      function: {
        name: 'click_on_web_page_element',
        description: 'Click on a specific element on the current web page',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'number',
              description: 'The id of the element to click on',
            },
          },
        },
      },
    },
    handler: async ({ id }) => {
      const el = state.page.locator(INTERACTIVE_SELECTOR).nth(id);
      await el.scrollIntoViewIfNeeded();
      await el.click();
      return { content: `Clicked on element [${id}]` };
    },
  };

  return {
    state,
    tools: [
      getWebPageContentTool,
      clickOnWebPageElementTool,
      getWebPageElementsTool,
    ],
  };
}

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

async function getInteractiveElements(page: playwright.Page): Promise<string> {
  const elements = page.locator(INTERACTIVE_SELECTOR);
  const count = await elements.count();

  const lines: string[] = [];

  for (let i = 0; i < count; i++) {
    const el = elements.nth(i);

    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const text = (await el.textContent())?.trim().slice(0, 50) || '';
    const attrs = await el.evaluate((e) => {
      return ['href', 'name', 'type', 'placeholder', 'aria-label']
        .map((a) => (e.getAttribute(a) ? `${a}="${e.getAttribute(a)}"` : ''))
        .filter(Boolean)
        .join(' ');
    });

    lines.push(`[${i}] <${tag}${attrs ? ' ' + attrs : ''}>${text}</${tag}>`);
  }

  return lines.join('\n');
}
