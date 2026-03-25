import {
  select,
  log,
  intro,
  outro,
  text,
  isCancel,
  confirm,
} from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { exists, mkdir, writeFile, rm } from 'node:fs/promises';
import {
  validateOpenAiKey,
  validateAnthropicKey,
  validateTelegramBotToken,
  validateBraveKey,
} from '../../config/validate';
import * as config from '../../config';
import { createConfigBuilder } from './config-builder';
import { onboard } from './onboard';

if (await exists(config.home)) {
  log.error(`${config.home} already exists`);
  process.exit(0);
}

if (await exists(config.path)) {
  log.error(`Config already exists at ${config.path}`);
  process.exit(0);
}

const configBuilder = createConfigBuilder();

intro("🤖 Welcome friend! Let's get you set up.");

const models = [
  { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'OpenAI GPT-5.4', value: 'gpt-5.4' },
];

const model = await select({
  message: 'What model would you like to use?',
  options: models,
});

if (isCancel(model)) {
  process.exit(0);
}

if (model === 'claude-sonnet-4-6') {
  log.info(
    'Go to https://platform.claude.com/settings/keys to get your API key'
  );
} else {
  log.info('Go to https://platform.openai.com/api-keys to get your API key');
}

const provider = model === 'claude-sonnet-4-6' ? 'anthropic' : 'openai';
const modelApiKey = await askForKey();

const modelName = models.find((m) => m.value === model)?.label;
log.success(`Valid key. Using ${modelName} as your primary model.`);

configBuilder.add(
  'models',
  `[
  {
    role: 'primary',
    model: getModel('${provider}', '${model}'),
    key: '${modelApiKey}',
  },
]`
);

log.info(
  'Greg works best with his Telegram integration. You can also use the TUI by running `greg tui`, or create your own custom client'
);

const setupTelegram = await select({
  message: 'Would you like to set up the Telegram client?',
  options: [
    { label: 'Yes (Recommended)', value: true },
    { label: 'No (You can set it up later)', value: false },
  ],
});

if (isCancel(setupTelegram)) {
  process.exit(0);
}

if (setupTelegram) {
  await askForTelegram();
}

const setupWebSearch = await select({
  message: 'Would you like to set up Web Search using Brave?',
  options: [
    { label: 'Yes (Recommended)', value: true },
    { label: 'No (You can set it up later)', value: false },
  ],
});

if (isCancel(setupWebSearch)) {
  process.exit(0);
}

if (setupWebSearch) {
  await askForBraveKey();
}

await mkdir(config.home, { recursive: true });
await writeFile(config.path, await configBuilder.get());

log.info('Validating config...');

if (!validateConfig()) {
  await rm(config.path);
  log.error(
    'Config isn’t valid. Aborting. Open an issue at https://github.com/kvendrik/greg/issues.'
  );
  process.exit(1);
}

log.success(`⚙️ Created config at: ${config.path}`);

if (!doctor()) {
  outro(`🤖✅ Done! Run 'greg doctor' to check for any issues.`);
  process.exit(1);
}

outro(
  `🤖✅ Done! Starting chat with Greg... ${setupTelegram ? "Run 'greg gateway start' to start the Telegram gateway." : ''}`
);

onboard();

async function askForKey(): Promise<string> {
  const modelApiKey = await text({
    message: 'Enter your API key',
    placeholder: 'sk-...',
    validate: (value) =>
      value?.trim() !== '' ? undefined : 'Value is required',
  });

  if (isCancel(modelApiKey)) {
    process.exit(0);
  }

  try {
    if (model === 'claude-sonnet-4-6') {
      await validateAnthropicKey(modelApiKey);
    } else {
      await validateOpenAiKey(modelApiKey);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('401')) {
      log.error('Invalid API key');
      return askForKey();
    } else {
      log.error(error instanceof Error ? error.message : String(error));
      return askForKey();
    }
  }

  return modelApiKey;
}

type TelegramGetUpdatesJson = {
  result: {
    message?: {
      from?: {
        id: number;
        username?: string;
      };
    };
  }[];
};

function asTelegramGetUpdatesJson(
  data: unknown
): TelegramGetUpdatesJson | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.result)) return null;
  return data as TelegramGetUpdatesJson;
}

async function askForTelegram(): Promise<void> {
  log.info(
    `Open Telegram, message @BotFather, send /newbot, follow the prompts.`
  );

  const telegramBotToken = await text({
    message: 'Enter your Telegram bot token',
    placeholder: '...',
    validate: (value) =>
      value?.trim() !== '' ? undefined : 'Value is required',
  });

  if (isCancel(telegramBotToken) || typeof telegramBotToken !== 'string') {
    process.exit(0);
  }
  const telegramBotTokenStr = telegramBotToken;

  try {
    await validateTelegramBotToken(telegramBotTokenStr);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('invalid')) {
      log.error('Invalid Telegram bot token');
      return askForTelegram();
    } else {
      log.error(errorMessage);
      return askForTelegram();
    }
  }

  log.success('Valid token. Now let’s set up your Telegram sender ID.');

  const senderId = await getSenderId();

  configBuilder.add(
    'telegram',
    `{
        botToken: '${telegramBotTokenStr}',
        senderId: '${senderId}',
      }`
  );

  async function getSenderId(): Promise<number> {
    const done = await confirm({
      message:
        'Send a message to your bot. This will allow us to extract your sender ID. Done?',
    });

    if (isCancel(done)) {
      process.exit(0);
    }

    if (!done) {
      return getSenderId();
    }

    const httpRes = await fetch(
      `https://api.telegram.org/bot${telegramBotTokenStr}/getUpdates`
    );
    if (!httpRes.ok) {
      throw new Error('Failed to get updates');
    }
    const json: unknown = await httpRes.json();
    const parsed = asTelegramGetUpdatesJson(json);
    if (parsed === null) {
      log.error('Invalid response from Telegram');
      return getSenderId();
    }

    if (parsed.result.length === 0) {
      log.error('No updates found');
      return getSenderId();
    }

    const from = parsed.result[0]?.message?.from;

    if (!from || typeof from.id !== 'number') {
      log.error('Failed to get sender ID');
      return getSenderId();
    }

    const username =
      typeof from.username === 'string' ? from.username : 'unknown';

    const doneSenderId = await confirm({
      message: `Got sender ID. Use "${from.id}" (@${username}) as your Telegram sender ID.?`,
    });

    if (isCancel(doneSenderId)) {
      process.exit(0);
    }

    if (!doneSenderId) {
      return getSenderId();
    }

    log.success(
      `Using "${from.id}" (@${username}) as your Telegram sender ID.`
    );

    return from.id;
  }
}

async function askForBraveKey(): Promise<void> {
  const braveApiKey = await text({
    message: 'Enter your Brave API key',
    placeholder: '...',
    validate: (value) =>
      value?.trim() !== '' ? undefined : 'Value is required',
  });

  if (isCancel(braveApiKey)) {
    process.exit(0);
  }

  try {
    await validateBraveKey(braveApiKey);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('422')) {
      log.error('Invalid Brave API key');
      return askForBraveKey();
    } else {
      log.error(errorMessage);
      return askForBraveKey();
    }
  }

  configBuilder.add(
    'webSearch',
    `{
    provider: 'brave',
    key: '${braveApiKey}',
  }`,
    'tool'
  );
}

function validateConfig(): boolean {
  const result = spawnSync('greg', ['config', 'validate']);
  return result.status === 0;
}

function doctor(): boolean {
  const result = spawnSync('greg', ['doctor']);
  return result.status === 0;
}
