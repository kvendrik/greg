import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { Bot, GrammyError } from 'grammy';
import pc from 'picocolors';
import type { Config } from './types';
import {
  validateAllowBins,
  validateProfiles,
} from '../agent/tools/exec/validate';
import { createLogger } from '../utilities/logger';

const logger = createLogger();

type Messages = {
  successes: string[];
  info: string[];
  warnings: string[];
  errors: string[];
};

function log(messages: Messages): void {
  for (const msg of messages.successes) {
    logger.log(pc.green(`${msg} ✓`));
  }
  for (const msg of messages.info) {
    logger.log(pc.blue(`Optional: ${msg}`));
  }
  for (const msg of messages.warnings) {
    logger.warn(pc.yellow(`Warning: ${msg}`));
  }
  for (const msg of messages.errors) {
    logger.error(pc.red(msg));
  }
}

function assertModelsStructure(config: Config, messages: Messages): void {
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
    messages.info.push(
      'No fallback model configured for when primary model is overloaded'
    );
  }
}

function assertExecGuardStructure(config: Config): void {
  const execConfig = config.tools?.guard.exec;
  if (!execConfig) {
    return;
  }
  validateProfiles(execConfig.profiles);
  validateAllowBins(execConfig.allowBins, execConfig.profiles);
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
  try {
    const me = await bot.api.getMe();
    if (!me?.id) {
      throw new Error('Telegram Bot Token invalid');
    }
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 401) {
      throw new Error('Telegram Bot Token invalid (401 Unauthorized)');
    }
    if (err instanceof Error && err.message.includes('Telegram Bot Token')) {
      throw err;
    }
    throw new Error(
      `Telegram Bot Token invalid: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

const BROWSER_USE_ACCOUNT_URL =
  'https://api.browser-use.com/api/v2/billing/account';

async function validateBrowserUseKey(key: string): Promise<void> {
  const res = await fetch(BROWSER_USE_ACCOUNT_URL, {
    headers: { 'x-api-key': key },
  });
  if (res.status === 401) {
    throw new Error('Browser Use API key invalid (401 Unauthorized)');
  }
  if (res.status !== 200) {
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

export async function validate(config: Config): Promise<boolean> {
  const messages: Messages = {
    successes: [],
    info: [],
    warnings: [],
    errors: [],
  };

  try {
    assertModelsStructure(config, messages);
    assertExecGuardStructure(config);
    messages.successes.push('Config structure is valid');
  } catch (err) {
    messages.errors.push(err instanceof Error ? err.message : String(err));
    log(messages);
    return false;
  }

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
      checks.push({
        name: 'Google Gemini',
        run: () => validateGoogleKey(key),
      });
    } else {
      messages.warnings.push(
        `No validator configured for "${provider}". Could not validate key.`
      );
    }
  }

  if (config.tools?.browser?.key) {
    checks.push({
      name: 'Browser Use',
      run: () => validateBrowserUseKey(config.tools?.browser?.key!),
    });
  } else {
    messages.info.push('Browser automation not configured (tools.browser)');
  }

  if (!config.tools?.webSearch) {
    messages.info.push('Web search not configured (tools.webSearch)');
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

  if (config.telegram?.botToken) {
    checks.push({
      name: 'Telegram',
      run: () => validateTelegramBotToken(config.telegram!.botToken),
    });
  } else {
    messages.warnings.push(
      'Telegram client not configured (telegram). Either configure it or use a custom client.'
    );
  }

  const settled = await Promise.allSettled(checks.map((c) => c.run()));

  settled.forEach((s, index) => {
    if (s.status === 'fulfilled') {
      messages.successes.push(checks[index].name);
    }
    if (s.status === 'rejected') {
      messages.errors.push(`${checks[index].name}: ${s.reason}`);
    }
  });

  log(messages);
  return messages.errors.length === 0;
}
