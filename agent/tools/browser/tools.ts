import TurndownService from 'turndown';
import type { Tool } from '../types';
import { getCDPClient, type CDPClient } from './chrome';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const instructions =
  '## Browser\nBefore replying to the first message always run \`web_page_status\` and SILENTLY take note of what URL is open in the browser.';

async function getPageDetails(
  client: CDPClient
): Promise<{ href: string; title: string; detailsHeader: string }> {
  // Optimize: combine both evaluations into a single CDP call
  const result = await client.Runtime.evaluate({
    expression:
      'JSON.stringify({ href: window.location.href, title: window.document.title })',
    returnByValue: true,
  });
  const details = JSON.parse(result.result.value as string) as {
    href: string;
    title: string;
  };
  return {
    ...details,
    detailsHeader: `- URL: "${details.href}".\n- Title: "${details.title}".\n\n---\n\n`,
  };
}

const readWebPageTool: Tool<{ url: string }> = {
  spec: {
    name: 'read_web_page',
    description:
      'Read the contents for the page that is currently open as Markdown. If there’s images on the page always use screenshot_web_page as well so you can see whats there.',
    input_schema: {
      type: 'object',
      required: [],
      properties: {},
    },
  },
  handler: async () => {
    const client = await getCDPClient();
    const { detailsHeader } = await getPageDetails(client);

    try {
      const htmlResult = await client.Runtime.evaluate({
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      });

      if (htmlResult.exceptionDetails) {
        return {
          content: `${detailsHeader}Error reading page content: ${htmlResult.exceptionDetails.exception?.description ?? htmlResult.exceptionDetails.text}`,
        };
      }

      const html =
        typeof htmlResult.result?.value === 'string'
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

      const markdownContent = service.turndown(html).replace(/\s+/g, ' ');
      const content = `${detailsHeader}${markdownContent}`;

      return {
        content,
      };
    } catch (error) {
      return {
        content: `${detailsHeader}Error fetching web page: ${formatError(error)}`,
      };
    }
  },
};

const openWebPageTool: Tool<{ url: string }> = {
  spec: {
    name: 'open_web_page',
    description:
      'Open web page. Use snapshot_web_page to get interactive element IDs.',
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
      const { detailsHeader } = await getPageDetails(client);
      return { content: `Opened web page.\n\n${detailsHeader}` };
    } catch (error) {
      const client = await getCDPClient().catch(() => null);
      const pageDetails = client
        ? await getPageDetails(client).catch(() => null)
        : null;
      const detailsHeader =
        pageDetails?.detailsHeader ?? 'Current URL: (unknown)\n\n---\n\n';
      return {
        content: `${detailsHeader}Error getting web page content: ${formatError(error)}`,
      };
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
  handler: async () => {
    try {
      const client = await getCDPClient();
      const { detailsHeader } = await getPageDetails(client);
      const elements = await getInteractiveElements(client);
      const content = `${detailsHeader}What follows is a list of interactive elements by their ID. Keep in mind that the IDs are unique to this session.\n\n${elements}`;
      return {
        content,
      };
    } catch (error) {
      const client = await getCDPClient().catch(() => null);
      const pageDetails = client
        ? await getPageDetails(client).catch(() => null)
        : null;
      const detailsHeader =
        pageDetails?.detailsHeader ?? 'Current URL: (unknown)\n\n---\n\n';
      return {
        content: `${detailsHeader}Error getting web page content: ${formatError(error)}`,
      };
    }
  },
};

const clickOnWebPageElementTool: Tool<{ id: string }> = {
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
      // Optimize: query directly by data-agent-id attribute instead of querying all interactive elements
      const result = await client.Runtime.evaluate({
        expression: `
          (function() {
            var el = document.querySelector('[data-agent-id="${id}"]');
            if (!el) return JSON.stringify({ ok: false, error: 'not found' });
            el.scrollIntoView({ block: 'center' });
            el.focus();
            var r = el.getBoundingClientRect();
            var centerX = r.left + r.width / 2;
            var centerY = r.top + r.height / 2;
            return JSON.stringify({ ok: true, x: centerX, y: centerY });
          })()
        `,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Error clicking element [${id}]: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
        };
      }

      if (typeof result.result?.value !== 'string') {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Element [${id}] click result invalid`,
        };
      }

      let parsed: { ok: boolean; x?: number; y?: number };
      try {
        parsed = JSON.parse(result.result.value) as {
          ok: boolean;
          x?: number;
          y?: number;
        };
      } catch {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Element [${id}] click result invalid`,
        };
      }

      if (!parsed.ok) {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Element [${id}] not found`,
        };
      }

      const x = parsed.x ?? 0;
      const y = parsed.y ?? 0;
      const timestamp = Date.now() / 1000;

      await client.Input.dispatchMouseEvent({
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
        timestamp,
      });
      await client.Input.dispatchMouseEvent({
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
        timestamp: Date.now() / 1000,
      });

      // Only fetch page details after successful click (lazy evaluation)
      const { detailsHeader } = await getPageDetails(client);
      return {
        content: `${detailsHeader}Clicked on element [${id}]`,
      };
    } catch (error) {
      const client = await getCDPClient().catch(() => null);
      const pageDetails = client
        ? await getPageDetails(client).catch(() => null)
        : null;
      const detailsHeader =
        pageDetails?.detailsHeader ?? 'Current URL: (unknown)\n\n---\n\n';
      return {
        content: `${detailsHeader}Error interacting with web page: ${formatError(error)}`,
      };
    }
  },
};

const typeIntoWebPageElementTool: Tool<{ id: string; text: string }> = {
  spec: {
    name: 'type_into_web_page_element',
    description:
      'Clear and type new text into an input, textarea, or contenteditable element on the current web page. Use the id from snapshot_web_page. Use for search boxes, login fields, rich text editors, and other text inputs.',
    input_schema: {
      type: 'object',
      required: ['id', 'text'],
      properties: {
        id: {
          type: 'string',
          description:
            'The id of the input/textarea/contenteditable element (from snapshot_web_page)',
        },
        text: {
          type: 'string',
          description: 'The text to type into the element',
        },
      },
    },
  },
  handler: async ({ id, text }) => {
    try {
      const client = await getCDPClient();
      // Optimize: query directly by data-agent-id attribute instead of querying all interactive elements
      const result = await client.Runtime.evaluate({
        expression: `
          (function() {
            var el = document.querySelector('[data-agent-id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]');
            if (!el) return JSON.stringify({ ok: false, error: 'not found' });
            var tag = (el.tagName || '').toLowerCase();
            var isContentEditable = el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true';
            var isInputOrTextarea = tag === 'input' || tag === 'textarea';
            if (!isInputOrTextarea && !isContentEditable) return JSON.stringify({ ok: false, error: 'not an input, textarea, or contenteditable element' });
            el.scrollIntoView({ block: 'center' });
            el.focus();
            var r = el.getBoundingClientRect();
            var centerX = r.left + r.width / 2;
            var centerY = r.top + r.height / 2;
            return JSON.stringify({ ok: true, x: centerX, y: centerY });
          })()
        `,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Error typing into element [${id}]: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
        };
      }

      if (typeof result.result?.value !== 'string') {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Element [${id}] type-into result invalid`,
        };
      }

      let parsed: { ok: boolean; x?: number; y?: number; error?: string };
      try {
        parsed = JSON.parse(result.result.value) as {
          ok: boolean;
          x?: number;
          y?: number;
          error?: string;
        };
      } catch {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}Element [${id}] type-into result invalid`,
        };
      }

      if (!parsed.ok) {
        const { detailsHeader } = await getPageDetails(client);
        return {
          content: `${detailsHeader}${parsed.error === 'not found' ? `Element [${id}] not found` : `Element [${id}] is not an input, textarea, or contenteditable element`}`,
        };
      }

      const x = parsed.x ?? 0;
      const y = parsed.y ?? 0;
      const timestamp = Date.now() / 1000;

      // Click on the element to ensure focus
      await client.Input.dispatchMouseEvent({
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
        timestamp,
      });
      await client.Input.dispatchMouseEvent({
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
        timestamp: Date.now() / 1000,
      });

      // Clear existing text: Select All using the commands parameter (more reliable)
      await client.Input.dispatchKeyEvent({
        type: 'keyDown',
        modifiers: process.platform === 'darwin' ? 4 : 2, // Meta/Command=4 on Mac, Control=2 on others
        windowsVirtualKeyCode: 65, // 'A' key
        code: 'KeyA',
        key: 'a',
        commands: ['selectAll'],
        timestamp: Date.now() / 1000,
      });
      await client.Input.dispatchKeyEvent({
        type: 'keyUp',
        modifiers: process.platform === 'darwin' ? 4 : 2,
        windowsVirtualKeyCode: 65,
        code: 'KeyA',
        key: 'a',
        timestamp: Date.now() / 1000,
      });

      // Delete selected text
      await client.Input.dispatchKeyEvent({
        type: 'keyDown',
        windowsVirtualKeyCode: 46, // Delete key
        code: 'Delete',
        key: 'Delete',
        timestamp: Date.now() / 1000,
      });
      await client.Input.dispatchKeyEvent({
        type: 'keyUp',
        windowsVirtualKeyCode: 46,
        code: 'Delete',
        key: 'Delete',
        timestamp: Date.now() / 1000,
      });

      // Use native CDP insertText for reliable typing
      // This triggers all proper input events and works with React/Vue/etc.
      try {
        await client.Input.insertText({ text });
      } catch (insertError) {
        // Fallback: if insertText is not available, type character by character
        // This can happen if CDP version doesn't support insertText
        for (const char of text) {
          await client.Input.dispatchKeyEvent({
            type: 'char',
            text: char,
            timestamp: Date.now() / 1000,
          });
        }
      }

      // Only fetch page details after successful typing (lazy evaluation)
      const { detailsHeader } = await getPageDetails(client);
      return {
        content: `${detailsHeader}Typed into element [${id}]`,
      };
    } catch (error) {
      const client = await getCDPClient().catch(() => null);
      const pageDetails = client
        ? await getPageDetails(client).catch(() => null)
        : null;
      const detailsHeader =
        pageDetails?.detailsHeader ?? 'Current URL: (unknown)\n\n---\n\n';
      return {
        content: `${detailsHeader}Error typing into web page element: ${formatError(error)}`,
      };
    }
  },
};

const screenshotWebPageTool: Tool<Record<string, never>> = {
  spec: {
    name: 'screenshot_web_page',
    description:
      'Take a full-page screenshot of the currently open web page. Returns the image for the LLM to see. Use after opening or navigating to a page.',
    input_schema: {
      type: 'object',
      required: [],
      properties: {},
    },
  },
  handler: async () => {
    try {
      const client = await getCDPClient();
      const { detailsHeader } = await getPageDetails(client);
      const { data } = await client.Page.captureScreenshot({
        format: 'png',
        captureBeyondViewport: false,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Screenshot:\n\n${detailsHeader}`,
          },
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data,
            },
          },
        ],
      };
    } catch (error) {
      const client = await getCDPClient().catch(() => null);
      const pageDetails = client
        ? await getPageDetails(client).catch(() => null)
        : null;
      const detailsHeader =
        pageDetails?.detailsHeader ?? 'Current URL: (unknown)\n\n---\n\n';
      return {
        content: `${detailsHeader}Error taking screenshot: ${formatError(error)}`,
      };
    }
  },
};

const webSearchTool: Tool<{ query: string }> = {
  spec: {
    name: 'web_search',
    description:
      'Search the web using DuckDuckGo API. Returns search results including abstracts, related topics, and links.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
      },
    },
  },
  handler: async ({ query }) => {
    try {
      const url = `https://api.duckduckgo.com/html/?q=${encodeURIComponent(query)}&format=json`;
      const response = await fetch(url);

      if (!response.ok) {
        return {
          content: `Error fetching search results: ${response.status} ${response.statusText}`,
        };
      }

      const html = await response.text();

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

      service.addRule('cleanDuckDuckGoLinks', {
        filter: (node) => {
          return (
            node.nodeName === 'A' &&
            node.getAttribute('href')?.includes('/l/?uddg=')
          );
        },
        replacement: (content, node) => {
          // Skip empty links (icon/image links with no text)
          if (!content || content.trim() === '') {
            return '';
          }
          const href = (node as HTMLElement).getAttribute('href') || '';
          const match = href.match(/\/l\/\?uddg=([^&]+)/);
          if (match) {
            try {
              const decodedUrl = decodeURIComponent(match[1]);
              return `[${content}](${decodedUrl})`;
            } catch {
              return `[${content}](${href})`;
            }
          }
          return `[${content}](${href})`;
        },
      });

      const markdownContent = service.turndown(html).replace(/\s+/g, ' ');

      return {
        content: markdownContent,
      };
    } catch (error) {
      return {
        content: `Error performing web search: ${formatError(error)}`,
      };
    }
  },
};

const webPageStatusTool: Tool<Record<string, never>> = {
  spec: {
    name: 'web_page_status',
    description:
      'Check if a web page is currently open and return the current URL. Returns whether a page is open and which URL it is.',
    input_schema: {
      type: 'object',
      required: [],
      properties: {},
    },
  },
  handler: async () => {
    try {
      const client = await getCDPClient();
      const { detailsHeader, href } = await getPageDetails(client);

      if (href && href !== '') {
        return {
          content: `Web page is open.\n\n${detailsHeader}`,
        };
      } else {
        return {
          content: 'No web page is currently open.',
        };
      }
    } catch (error) {
      // If we can't get the client, assume no page is open
      return {
        content: `No web page is currently open. Error: ${formatError(error)}`,
      };
    }
  },
};

export const tools = [
  openWebPageTool,
  readWebPageTool,
  getWebPageElementsTool,
  clickOnWebPageElementTool,
  typeIntoWebPageElementTool,
  screenshotWebPageTool,
  webSearchTool,
  webPageStatusTool,
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
        return JSON.stringify(Array.from(els).map(function(e) {
          var tag = e.tagName.toLowerCase();
          var role = (e.getAttribute('role') || '');
          var text = (e.textContent || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
          var label = e.getAttribute('aria-label') || '';
          var typeAttr = tag === 'input' ? (e.getAttribute('type') || 'text') : '';
          e.setAttribute('data-agent-id', Math.random().toString(36).substring(2, 15));
          return { id: e.getAttribute('data-agent-id'), tag: tag, text: text, typeAttr: typeAttr, roleAttr: role, label };
        }));
      })()
    `,
      returnByValue: true,
    })
  ).result?.value;

  if (typeof raw !== 'string') return '';

  try {
    const items = JSON.parse(raw) as Array<{
      id: string;
      tag: string;
      text: string;
      label: string;
      typeAttr: string;
      roleAttr?: string;
    }>;
    const formatted = items
      .map((item, i) => {
        const text = item.text || '(no text)';
        const type = `${item.tag}${item.typeAttr ? ` type="${item.typeAttr}"` : ''} ${item.roleAttr ? `role="${item.roleAttr}"` : ''} ${item.label ? `aria-label="${item.label}"` : ''}`;
        return `[${item.id}] "${text}" <${type} />`;
      })
      .join('\n');
    return formatted;
  } catch {
    throw new Error('Failed to parse interactive elements');
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
