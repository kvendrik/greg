import { startServer } from './server';
import { TelegramGateway } from '../clients/telegram';
import * as classifier from '../classifier';
import { startCronScheduler } from '../agent/tools/cron';
import { startHeartbeat } from './heartbeat';
import * as sessions from './sessions';
import config from '../.greg';
import pc from 'picocolors';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function start() {
  let stopClassifier: (() => void) | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let stopCron: (() => void) | undefined;

  if (config.tools?.guard?.enabled) {
    console.log(pc.cyan('Starting guard classifier...'));
    stopClassifier = classifier.start();
  }

  console.log(pc.cyan('Starting server...'));
  await startServer();

  if (config.heartbeat?.enabled ?? true) {
    console.log(pc.cyan(`Starting heartbeat...`));
    stopHeartbeat = startHeartbeat(
      { workspace: config.workspace, options: config.heartbeat },
      async (instruction: string, opts) => {
        console.log(pc.cyan(`Running heartbeat prompt...`));
        const session = await sessions.load('main');
        await session.prompt(
          { content: instruction, images: [] },
          { heartbeatAckMaxChars: opts?.ackMaxChars }
        );
      }
    );
  }

  if (config.cron?.enabled) {
    console.log(pc.cyan('Starting cron scheduler...'));
    stopCron = await startCronScheduler(config, async (job) => {
      console.log(pc.cyan(`Running cron job. Prompt: "${job.jobPrompt}".`));
      const session = await sessions.load(`job:${job.id}`);
      await session.prompt({ content: job.jobPrompt, images: [] });
    });
  }

  if (config.clients?.telegram) {
    const gateway = await TelegramGateway.create();
    console.log(pc.cyan('Starting Telegram service...'));
    await gateway.start();
  }

  const shutdown = () => {
    console.log(pc.cyan('Shutting down...'));
    stopHeartbeat?.();
    stopCron?.();
    stopClassifier?.();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
