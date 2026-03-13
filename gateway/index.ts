import { startServer } from './server';
import { TelegramGateway } from '../clients/telegram';
import * as classifier from '../classifier';
import * as heartbeat from './heartbeat';
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
  let stopHeartbeat: (() => void) | undefined;
  let stopCron: (() => void) | undefined;

  if (config.tools?.guard?.enabled) {
    logger.info('Starting guard classifier...');
    stopClassifier = classifier.start();
  }

  logger.info('Starting server...');
  await startServer();

  if (config.heartbeat?.enabled ?? true) {
    logger.info('Starting heartbeat...');

    stopHeartbeat = await heartbeat.start(async (prompt: string) => {
      logger.info('Running heartbeat prompt...');

      const session = await sessions.load('main');

      const { success, error } = await new Promise<{
        success: boolean;
        error?: string;
      }>((resolve) =>
        session.prompt(
          { content: prompt, images: [] },
          {
            channelId: null,
            callbacks: {
              onError: (error) => resolve({ success: false, error }),
              onTurnDone: () => resolve({ success: true, error: undefined }),
            },
          }
        )
      );

      return { success, error };
    });
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
    stopHeartbeat?.();
    stopCron?.();
    stopClassifier?.();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info('✅ Gateway ready.');
}
