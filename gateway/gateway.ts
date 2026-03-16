import { Heartbeat } from './heartbeat';
import * as sessions from './sessions';
import { createLogger } from '../utilities/logger';
import { get as getConfig, validate as validateConfig } from '../config';

const logger = createLogger('GW');

interface GatewayState {
  /**
   * Method to get a reply from the user.
   * Used by the Guard to get a reply from the user.
   */
  getReply: ((message: string) => Promise<string>) | null;
}

export let state: GatewayState = {
  getReply: null,
};

export async function start(): Promise<{
  stop: () => void;
  setGetReply: (getReply: (message: string) => Promise<string>) => void;
}> {
  const config = await getConfig();

  logger.info('Validating config...');
  const failures = await validateConfig(config);

  if (failures.length > 0) {
    logger.error('Config validation failed. Exiting...');
    process.exit(1);
  }

  let heartbeat: Heartbeat | null = null;

  if (config.heartbeat?.enabled) {
    logger.info('Starting heartbeat...');
    heartbeat = new Heartbeat(config.heartbeat);
    heartbeat.start();
  }

  logger.info('Loading main session...');
  await sessions.load('main');

  logger.info('✅ Gateway ready.');

  return {
    stop() {
      logger.info('🛑 Shutting down...');
      heartbeat?.stop();
    },
    setGetReply(getReply: (message: string) => Promise<string>): void {
      state.getReply = async (message: string) => {
        logger.info(`Getting reply for message: "${message}"`);
        const reply = await getReply(message);
        logger.info(`User replied: "${reply}"`);
        return reply;
      };
    },
  };
}
