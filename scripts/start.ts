import { start } from '../gateway';
import { get as getConfig } from '../config';
import { createLogger } from '../utilities/logger';

const logger = createLogger('GW');

const { setGetReply } = await start();
const config = await getConfig();

if (config.clients?.telegram) {
  logger.info('✉️  Starting Telegram service...');
  const { TelegramGateway } = await import('../clients/telegram');
  const gateway = await TelegramGateway.create();
  await gateway.start();
  setGetReply(gateway.getReply.bind(gateway));
  logger.info('✅ Telegram client ready.');
}
