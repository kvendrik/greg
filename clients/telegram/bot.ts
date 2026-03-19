import { Bot, type Context } from 'grammy';
import { FileFlavor } from '@grammyjs/files';
import { hydrateFiles } from '@grammyjs/files';
import * as config from '../../config';

const env = await getTelegramEnv();
const botToken = env.botToken;

export type BotContext = FileFlavor<Context>;

export const bot = new Bot<BotContext>(botToken);
bot.api.config.use(hydrateFiles(bot.token));

export const senderId = env.senderId;

async function getTelegramEnv(): Promise<{
  botToken: string;
  senderId: string;
}> {
  const { telegram } = await config.get();

  if (!telegram) {
    console.warn(`
  Telegram client is not configured. Please configure it.
  
  \`\`\`ts
  const config: Config = {
    ...
    telegram: {
      // Open Telegram, message @BotFather, send /newbot, follow the prompts
      // (name and username ending in _bot); BotFather will reply with your token once
      // (format 123456789:ABCdef...).
      botToken: 'XXX',
      // Your user ID is message.from.id. After sending a message to your bot, run:
      // curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
      // and read "from"."id" in the last message.
      senderId: 'XXX',
    },
    ...
  };
  \`\`\`  
      `);
    process.exit(1);
  }

  return telegram;
}
