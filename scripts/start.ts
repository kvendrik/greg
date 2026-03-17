import { start } from '../gateway';
import { get as getConfig } from '../config';
import { createLogger } from '../utilities/logger';
import * as gateway from '../gateway';
import pc from 'picocolors';
import { text, isCancel, log } from '@clack/prompts';

const logger = createLogger('GW');
const config = await getConfig();

const { setGetReply, stop } = await start();

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

if (process.env.GREG_CLIENT === 'cli') {
  await startCLIClient();
} else if (config.clients?.telegram) {
  await startTelegramClient();
} else {
  console.warn(
    pc.yellow(
      'No client specified. Specify `config.clients.telegram` or use `--client cli` to start a CLI client.'
    )
  );
}

function shutdown() {
  stop();
  process.exit(0);
}

async function startCLIClient() {
  const session = gateway.get('main');

  session.subscribe('cli', {
    onTurnStart: () => {},
    onThinking: (chunk) => process.stdout.write(pc.gray(chunk)),
    onContent: (chunk) => process.stdout.write(pc.blue(chunk)),
    onToolcall: async (name, args) =>
      log.info(pc.cyan(`[${name}](${JSON.stringify(args)})`)),
    onTurnDone: async () => {},
    onTurnStop: async () => {},
    onError: async (error: string) => log.error(pc.red(error)),
  });

  while (true) {
    const input = await text({
      message: 'You:',
      placeholder: 'Type your message here...',
    });
    if (isCancel(input) || input === '/exit') break;
    await session.prompt({ content: input, images: [] }, { channelId: 'cli' });
  }
}

async function startTelegramClient() {
  logger.info('✉️  Starting Telegram service...');
  const { TelegramGateway } = await import('../clients/telegram');
  const gateway = await TelegramGateway.create();
  await gateway.start();
  setGetReply(gateway.getReply.bind(gateway));
  logger.info('✅ Telegram client ready.');
}
