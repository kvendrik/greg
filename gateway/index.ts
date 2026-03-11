import { startServer } from './server';
import { TelegramGateway } from '../clients/telegram';
import * as classifier from '../classifier';
import config from '../.greg';

start();

async function start() {
  if (config.clients?.telegram) {
    const gateway = await TelegramGateway.create();
    await gateway.start();
  }

  if (config.tools?.guard?.enabled) {
    classifier.start();
  }

  await startServer();
}
