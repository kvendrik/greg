import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { Bot } from 'grammy';
import pc from 'picocolors';
import type { Config } from './types';

function assertModelsStructure(config: Config): void {
  const primaryCount = config.models.filter((m) => m.role === 'primary').length;
  const fallbackCount = config.models.filter(
    (m) => m.role === 'fallback'
  ).length;

  if (primaryCount !== 1) {
    throw new Error(
      `Config models must have exactly one primary entry, got ${primaryCount}`
    );
  }
  if (fallbackCount !== 1) {
    throw new Error(
      `Config models must have exactly one fallback entry, got ${fallbackCount}`
    );
  }
}

async function validateOpenAiKey(key: string): Promise<void> {
  const client = new OpenAI({ apiKey: key });
  for await (const _ of client.models.list()) {
    break;
  }
}

async function validateAnthropicKey(key: string): Promise<void> {
  const client = new Anthropic({ apiKey: key });
  for await (const _ of client.models.list()) {
    break;
  }
}

async function validateGoogleKey(key: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: key });
  await ai.models.countTokens({
    model: 'gemini-3-flash-preview',
    contents: 'x',
  });
}

async function validateTelegramBotToken(token: string): Promise<void> {
  const bot = new Bot(token);
  await bot.api.getMe();
}

async function validateBrowserUseKey(key: string): Promise<void> {
  const res = await fetch('https://api.browser-use.com/api/v1/me', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) {
    throw new Error('Browser Use API key invalid (401 Unauthorized)');
  }
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(
      `Browser Use API error (${res.status}): ${body || res.statusText}`
    );
  }
}

const BRAVE_WEB_SEARCH_ENDPOINT =
  'https://api.search.brave.com/res/v1/web/search';

async function validateBraveKey(apiKey: string): Promise<void> {
  const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
  url.searchParams.set('q', 'test');
  url.searchParams.set('count', '1');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Subscription-Token': apiKey,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) {
    throw new Error('Brave Search API key invalid (401 Unauthorized)');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Brave Search API error (${res.status}): ${body || res.statusText}`
    );
  }
}

export type ValidateOptions = { exit?: boolean };

export async function validate(
  config: Config,
  options?: ValidateOptions
): Promise<string[]> {
  assertModelsStructure(config);

  console.info(pc.green('Config structure is valid ✓'));

  const providersToKeys = new Map<string, string>();
  for (const entry of config.models) {
    const provider = entry.model.provider;
    if (!providersToKeys.has(provider)) {
      providersToKeys.set(provider, entry.key);
    }
  }

  const checks: { name: string; run: () => Promise<void> }[] = [];

  for (const [provider, key] of providersToKeys) {
    if (provider === 'openai') {
      checks.push({ name: 'OpenAI', run: () => validateOpenAiKey(key) });
    } else if (provider === 'anthropic') {
      checks.push({ name: 'Anthropic', run: () => validateAnthropicKey(key) });
    } else if (provider === 'google') {
      checks.push({ name: 'Google Gemini', run: () => validateGoogleKey(key) });
    }
  }

  if (config.tools?.browser?.key) {
    checks.push({
      name: 'Browser Use',
      run: () => validateBrowserUseKey(config.tools?.browser?.key!),
    });
  }

  if (config.tools?.webSearch?.provider === 'gemini') {
    checks.push({
      name: 'Web Search (Gemini)',
      run: () => validateGoogleKey(config.tools?.webSearch!.key!),
    });
  }

  if (config.tools?.webSearch?.provider === 'brave') {
    checks.push({
      name: 'Web Search (Brave)',
      run: () => validateBraveKey(config.tools?.webSearch!.key!),
    });
  }

  if (config.clients?.telegram?.botToken) {
    checks.push({
      name: 'Telegram',
      run: () => validateTelegramBotToken(config.clients!.telegram!.botToken),
    });
  }

  const results = await Promise.allSettled(checks.map((c) => c.run()));
  const failures: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.info(pc.green(`${checks[index].name}: ${pc.green('✓')}`));
    }
    if (result.status === 'rejected') {
      console.error(pc.red(`${checks[index].name}: ${result.reason}`));
      failures.push(checks[index].name);
    }
  });

  const exitOnFailure = options?.exit !== false;

  if (exitOnFailure) {
    process.exit(failures.length > 0 ? 1 : 0);
  }

  return failures;
}
