import { startServer } from './server';
import { Heartbeat } from './heartbeat';
import * as sessions from './sessions';
import { createLogger } from '../utilities/logger';
import { get as getConfig, validate as validateConfig } from '../config';
import type { TelegramGateway } from '../clients/telegram';

const logger = createLogger('GW');

interface GatewayState {
  getReply: ((message: string) => Promise<string>) | null;
}

export let state: GatewayState = {
  getReply: null,
};

function setGetReply(getReply: (message: string) => Promise<string>): void {
  state.getReply = async (message: string) => {
    logger.info(`Getting reply for message: "${message}"`);
    const reply = await getReply(message);
    logger.info(`User replied: "${reply}"`);
    return reply;
  };
}

export async function start() {
  const config = await getConfig();

  logger.info('Validating config...');
  const failures = await validateConfig(config);

  if (failures.length > 0) {
    logger.error('Config validation failed. Exiting...');
    process.exit(1);
  }

  let heartbeat: Heartbeat | null = null;

  logger.info('Starting server...');
  await startServer(config.port);

  if (config.heartbeat?.enabled ?? true) {
    logger.info('Starting heartbeat...');
    heartbeat = new Heartbeat(config.heartbeat);
    heartbeat.start();
  }

  logger.info('Loading main session...');
  await sessions.load('main');

  const shutdown = () => {
    logger.info('Shutting down...');
    heartbeat?.stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info('✅ Gateway ready.');

  if (config.clients?.telegram) {
    logger.info('✉️  Starting Telegram service...');
    const { TelegramGateway } = await import('../clients/telegram');
    const gateway = await TelegramGateway.create();
    await gateway.start();
    setGetReply(gateway.getReply.bind(gateway));
    logger.info('✅ Telegram client ready.');
  }
}
