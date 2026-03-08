import config from '../../.greg';

export function getTelegramEnv(): typeof config.clients.telegram {
  if (!config.clients.telegram) {
    console.warn(`
Telegram client is not configured. Please configure it in your config.ts file.

\`\`\`ts
const config: Config = {
  ...
  clients: {
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
  },
  ...
};
\`\`\`  
    `);
    throw new Error(
      'Missing TELEGRAM_BOT_TOKEN. Open Telegram, message @BotFather, send /newbot, follow the prompts (name and username ending in _bot); BotFather will reply with your token once (format 123456789:ABCdef...). Set it in .env and restart.'
    );
  }

  return config.clients.telegram;
}
