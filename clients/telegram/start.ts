import { start } from '../../gateway';
import { get as getConfig } from '../../config';
import { createLogger } from '../../utilities/logger';

const config = await getConfig();

if (!config.clients?.telegram) {
  throw new Error('Telegram client is not configured.');
}

const { setGetReply, stop } = await start();

await startTelegramClient();

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  stop();
  process.exit(0);
}

async function startTelegramClient() {
  const logger = createLogger('GW');
  logger.info('✉️  Starting Telegram service...');
  const { TelegramGateway } = await import('./gateway');
  const gateway = await TelegramGateway.create();
  await gateway.start();
  setGetReply(gateway.getReply.bind(gateway));
  logger.info('✅ Telegram client ready.');
}
