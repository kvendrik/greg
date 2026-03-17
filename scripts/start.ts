import { start } from '../gateway';
import { get as getConfig } from '../config';
import { createLogger } from '../utilities/logger';
import pc from 'picocolors';

const logger = createLogger('GW');
const config = await getConfig();

const { setGetReply, stop } = await start();

if (config.clients?.telegram) {
  await startTelegramClient();
} else {
  console.warn(
    pc.yellow(
      'No client specified. Specify `config.clients.telegram` or use `--client cli` to start a CLI client.'
    )
  );
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  stop();
  process.exit(0);
}

async function startTelegramClient() {
  logger.info('✉️  Starting Telegram service...');
  const { TelegramGateway } = await import('../clients/telegram');
  const gateway = await TelegramGateway.create();
  await gateway.start();
  setGetReply(gateway.getReply.bind(gateway));
  logger.info('✅ Telegram client ready.');
}
