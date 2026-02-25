import { Bot, type Context } from 'grammy';
import { getTelegramEnv } from './utilities';

const { botToken, senderId } = getTelegramEnv();

const message = process.argv[2];

if (!message) {
  console.log('Usage: bun run clients:telegram:send-message.ts <message>');
  process.exit(1);
}

const bot = new Bot<Context>(botToken);
await bot.api.sendMessage(senderId, message);

console.log(`Sent "${message}"`);
process.exit(0);
