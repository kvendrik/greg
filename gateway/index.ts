import { startServer } from './server';
import { TelegramGateway } from '../clients/telegram';
import * as classifier from '../classifier';
import config from '../.greg';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function start() {
  let stopClassifier: (() => void) | undefined;

  if (config.tools?.guard?.enabled) {
    stopClassifier = classifier.start();
  }

  await startServer();

  if (config.clients?.telegram) {
    const gateway = await TelegramGateway.create();
    await gateway.start();
  }

  const shutdown = () => {
    stopClassifier?.();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
