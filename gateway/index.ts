import { startServer } from './server';
import { TelegramGateway } from '../clients/telegram';
import * as classifier from '../classifier';
import { Heartbeat } from './heartbeat';
import * as sessions from './sessions';
import { createLogger } from '../utilities/logger';
import config from '../.greg';

const logger = createLogger('GW');

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function start() {
  let stopClassifier: (() => void) | undefined;
  let stopCron: (() => void) | undefined;
  let heartbeat: Heartbeat | null = null;

  if (config.tools?.guard?.enabled) {
    logger.info('Starting guard classifier...');
    stopClassifier = classifier.start();
  }

  logger.info('Starting server...');
  await startServer();

  if (config.heartbeat?.enabled ?? true) {
    logger.info('Starting heartbeat...');
    heartbeat = new Heartbeat();
    heartbeat.start();
  }

  if (config.clients?.telegram) {
    const gateway = await TelegramGateway.create();
    logger.info('Starting Telegram service...');
    await gateway.start();
  }

  logger.info('Loading main session...');
  await sessions.load('main');

  const shutdown = () => {
    logger.info('Shutting down...');
    heartbeat?.stop();
    stopCron?.();
    stopClassifier?.();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info('✅ Gateway ready.');
}
