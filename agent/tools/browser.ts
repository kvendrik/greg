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
          waitUntil: 'domcontentloaded',
        });
      } catch (error) {
        return { content: 'Error getting web page content' };
      }

      const content = await state.page.content();
      const markdown = convert(content, {
        skipImages: true,
      });
      return { content: markdown };
    },
  };

  const clickOnWebPageElementTool: Tool<{ selector: string }> = {
    spec: {
      type: 'function',
      function: {
        name: 'click_on_web_page_element',
        description: 'Click on a specific element on the web page',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            selector: {
              type: 'string',
              description: 'The JavaScript selector of the element to click on',
            },
          },
        },
      },
    },
    handler: async ({ selector }) => {
      await state.page.click(selector);
      return { content: `Clicked on ${selector}` };
    },
  };

  return {
    state,
    tools: [getWebPageContentTool, clickOnWebPageElementTool],
  };
}
