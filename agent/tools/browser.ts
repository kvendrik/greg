import playwright from 'playwright';
import type { Tool } from './types';
import { convert } from '@kreuzberg/html-to-markdown-node';
import { execSync } from 'child_process';
import Database from 'bun:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
      name: 'open_web_page',
      description: 'Open a web page when the user asks to visit a site, look something up, or use a web app. Use Google/DuckDuckGo to find the URL when needed. Do not use for greetings or small talk.',
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
      state.browser = state.browser ?? (await playwright.chromium.launch());
      state.context = state.context ?? (await state.browser.newContext());
      state.page = state.context.pages()[0];

      try {
        await state.page.goto(url, { waitUntil: 'load' });
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

  const getWebPageElementsTool: Tool<Record<string, never>> = {
    spec: {
      name: 'get_web_page_elements',
      description: 'Get interactive element IDs on the current web page (after you opened one for a user request). Use with click_on_web_page_element. Do not use unless the user asked for something that requires the browser.',
      input_schema: {
        type: 'object',
        properties: {},
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
      name: 'click_on_web_page_element',
      description: 'Click on a specific element on the current web page. Use the id from get_web_page_elements.',
      input_schema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'number',
            description: 'The id of the element to click on (from get_web_page_elements)',
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

const CHROME_COOKIES = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome/Default/Cookies'
);
const TEMP_COOKIES = `${os.homedir()}/.pa-agent/chrome-cookies-copy`;
const PROFILE_DIR = `${os.homedir()}/.pa-agent/playwright-profile`;

function getDerivedKey(): Buffer {
  const password = execSync(
    'security find-generic-password -w -a "Chrome" -s "Chrome Safe Storage"'
  )
    .toString()
    .trim();
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function decrypt(encryptedValue: Buffer, key: Buffer): string {
  try {
    const iv = Buffer.alloc(16, ' ');
    const payload = encryptedValue.slice(3);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString(
      'utf8'
    );
  } catch {
    return '';
  }
}

async function getBrowserContext(): Promise<playwright.BrowserContext> {
  fs.copyFileSync(CHROME_COOKIES, TEMP_COOKIES);

  const key = getDerivedKey();
  const db = new Database(TEMP_COOKIES, { readonly: true });

  const rows = db
    .prepare(
      `
    SELECT host_key, name, path, value, encrypted_value,
           expires_utc, is_secure, is_httponly, samesite
    FROM cookies
  `
    )
    .all() as any[];

  const cookies = rows
    .map((row) => {
      const value =
        row.encrypted_value?.length > 3
          ? decrypt(row.encrypted_value, key)
          : row.value;

      // Chrome stores expiry as microseconds since 1601-01-01
      const expires = row.expires_utc
        ? (row.expires_utc / 1000 - 11644473600000) / 1000
        : undefined;

      return {
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        expires,
        secure: row.is_secure === 1,
        httpOnly: row.is_httponly === 1,
        sameSite: (['Strict', 'Lax', 'None'][row.samesite] ?? 'None') as
          | 'Strict'
          | 'Lax'
          | 'None',
      };
    })
    .filter((c) => {
      if (!c.value) return false;
      if (!c.name) return false;
      if (c.expires !== undefined && (isNaN(c.expires) || c.expires < 0))
        return false;
      return true;
    })
    .map((c) => {
      // Playwright wants undefined, not 0 or negative, for session cookies
      if (c.expires !== undefined && c.expires <= 0) {
        const { expires, ...rest } = c;
        return rest;
      }
      return c;
    });

  db.close();

  const context = await playwright.chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: false,
      executablePath:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    }
  );

  for (const cookie of cookies) {
    try {
      await context.addCookies([cookie]);
    } catch (e) {
      console.warn('Bad cookie:', JSON.stringify(cookie, null, 2));
    }
  }

  return context;
}
