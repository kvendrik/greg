import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { Bot } from 'grammy';
import pc from 'picocolors';

import { isSafe as isGuardSafe } from '../agent/tools/utilities/guard/guard';
import type { Config } from './types';
import type { GuardMethods } from '../agent/tools/utilities/guard/guard';

const GUARD_METHODS: GuardMethods[] = ['patterns', 'classifier', 'all'];

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

function configUsesClassifier(config: Config): boolean {
  const guard = config.tools.guard;
  if (!guard?.enabled) {
    return false;
  }
  if (guard.use === 'classifier' || guard.use === 'all') {
    return true;
  }
  const allowlist = guard.allowlist ?? {};
  const allEntries = Object.values(allowlist).flatMap((group) =>
    Object.values(group ?? {})
  );
  return allEntries.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'use' in entry &&
      (entry as { use: string }).use === 'classifier'
  );
}

function assertGuardOptions(config: Config): void {
  const guard = config.tools.guard;
  if (!guard) {
    return;
  }

  if (!GUARD_METHODS.includes(guard.use)) {
    throw new Error(
      `Config tools.guard.use must be one of ${GUARD_METHODS.join(', ')}, got "${guard.use}"`
    );
  }
}

async function validateGuardLoad(config: Config): Promise<void> {
  const result = await isGuardSafe(config, 'x', {
    use: 'all',
    name: 'test',
    logging: false,
  });
  if (!result.safe) {
    throw new Error(result.message);
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

export type ValidateOptions = { exit?: boolean };

export async function validate(
  config: Config,
  options?: ValidateOptions
): Promise<string[]> {
  assertModelsStructure(config);
  assertGuardOptions(config);
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

  if (config.tools.browser?.key) {
    checks.push({
      name: 'Browser Use',
      run: () => validateBrowserUseKey(config.tools.browser!.key),
    });
  }

  if (config.tools.webSearch?.geminiKey) {
    checks.push({
      name: 'Web Search (Gemini)',
      run: () => validateGoogleKey(config.tools.webSearch!.geminiKey),
    });
  }

  if (config.clients?.telegram?.botToken) {
    checks.push({
      name: 'Telegram',
      run: () => validateTelegramBotToken(config.clients!.telegram!.botToken),
    });
  }

  if (configUsesClassifier(config)) {
    checks.push({
      name: 'Guard',
      run: () => validateGuardLoad(config),
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
