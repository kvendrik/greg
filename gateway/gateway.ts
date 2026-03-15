import { startServer } from './server';
import { Heartbeat } from './heartbeat';
import * as sessions from './sessions';
import { createLogger } from '../utilities/logger';
import { get as getConfig, validate as validateConfig } from '../config';
import type { TelegramGateway } from '../clients/telegram';

const logger = createLogger('GW');

interface GatewayState {
  telegram: TelegramGateway | null;
}

export let state: GatewayState = {
  telegram: null,
};

export async function start() {
  const config = await getConfig();
  await validateConfig(config, {
    exit: true,
  });

  let heartbeat: Heartbeat | null = null;

  logger.info('Starting server...');
  await startServer(config.port);

  if (config.heartbeat?.enabled ?? true) {
    logger.info('Starting heartbeat...');
    heartbeat = new Heartbeat(config.heartbeat);
    heartbeat.start();
  }

  if (config.clients?.telegram) {
    const { TelegramGateway } = await import('../clients/telegram');
    const gateway = await TelegramGateway.create();
    logger.info('Starting Telegram service...');
    await gateway.start();
    state.telegram = gateway;
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
}
