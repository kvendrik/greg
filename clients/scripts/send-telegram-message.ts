import { Bot, type Context } from 'grammy';

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_SENDER_ID) {
  console.error('TELEGRAM_BOT_TOKEN or TELEGRAM_SENDER_ID missing');
  process.exit(1);
}

const message = process.argv[2];

if (!message) {
  console.log('Usage: send-telegram-message <message>');
  process.exit(1);
}

const bot = new Bot<Context>(process.env.TELEGRAM_BOT_TOKEN!);
await bot.api.sendMessage(process.env.TELEGRAM_SENDER_ID, message);

console.log(`Sent "${message}"`);
process.exit(0);
