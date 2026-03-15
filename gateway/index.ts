import { start } from './gateway';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
