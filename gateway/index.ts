import { startServer } from './server';
import { TelegramGateway } from '../clients/telegram';
import * as classifier from '../classifier';
import { startCronScheduler } from '../agent/tools/cron';
import * as sessions from './sessions';
import config from '../.greg';
import pc from 'picocolors';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function start() {
  let stopClassifier: (() => void) | undefined;

  if (config.tools?.guard?.enabled) {
    console.log(pc.cyan('Starting guard classifier...'));
    stopClassifier = classifier.start();
  }

  console.log(pc.cyan('Starting server...'));
  await startServer();

  console.log(pc.cyan('Starting cron scheduler...'));
  const stopCron = await startCronScheduler(config, runCronPrompt);

  if (config.clients?.telegram) {
    const gateway = await TelegramGateway.create();
    console.log(pc.cyan('Starting Telegram service...'));
    await gateway.start();
  }

  const shutdown = () => {
    console.log(pc.cyan('Shutting down...'));
    stopCron();
    stopClassifier?.();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function runCronPrompt(jobPrompt: string) {
  console.log(pc.cyan(`Running cron job. Prompt: "${jobPrompt}".`));
  const session = await sessions.load('main');
  await session.prompt({ content: jobPrompt, images: [] });
}
