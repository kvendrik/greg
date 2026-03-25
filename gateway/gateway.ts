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
  getReply:
    | ((
        message: string,
        details: {
          toolName: string;
          toolParams: Record<string, unknown>;
          prettyParams: string;
          commandsHint: string;
        }
      ) => Promise<string>)
    | null;
}

export const state: GatewayState = {
  getReply: null,
};

export async function start(): Promise<{
  stop: () => void;
  setGetReply: (getReply: GatewayState['getReply']) => void;
}> {
  const config = await getConfig();

  logger.info('Validating config...');
  const valid = await validateConfig(config);

  if (!valid) {
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

  if (!sessions.exists('main')) {
    logger.info('Main session not found. Creating...');
    await sessions.create('main');
  }

  logger.info('Loading main session...');
  await sessions.load('main');

  logger.info('✅ Gateway ready.');

  return {
    stop() {
      logger.info('🛑 Shutting down...');
      heartbeat?.stop();
    },
    setGetReply(getReply: GatewayState['getReply']): void {
      if (!getReply) {
        return;
      }
      state.getReply = async (message: string, details) => {
        logger.info(`Getting reply for message: "${message}"`);
        const reply = await getReply(message, details);
        logger.info(`User replied: "${reply}"`);
        return reply;
      };
    },
  };
}
