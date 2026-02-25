export type TelegramEnv = { botToken: string; senderId: string };

export function getTelegramEnv(): TelegramEnv {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const senderId = process.env.TELEGRAM_SENDER_ID;

  if (!botToken) {
    throw new Error(
      'Missing TELEGRAM_BOT_TOKEN. Open Telegram, message @BotFather, send /newbot, follow the prompts (name and username ending in _bot); BotFather will reply with your token once (format 123456789:ABCdef...). Set it in .env and restart.'
    );
  }

  if (!senderId) {
    throw new Error(
      'Missing TELEGRAM_SENDER_ID. Per Telegram Bot API docs (core.telegram.org/bots/api): your user ID is in message.from.id when you send a message to your bot. Send a message to your bot, then call GET https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates and read the "from.id" of your message. Set that value in .env as TELEGRAM_SENDER_ID and restart.'
    );
  }

  return { botToken, senderId };
}
