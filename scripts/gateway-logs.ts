import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const logDir = '.logs';
const logFiles = [
  join(logDir, 'gateway-out.log'),
  join(logDir, 'gateway-error.log'),
];

mkdirSync(logDir, { recursive: true });
for (const logPath of logFiles) {
  if (!existsSync(logPath)) {
    writeFileSync(logPath, '');
  }
}

let lines = '50';
let stream = true;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--lines') {
    const nextIndex = index + 1;
    if (nextIndex < argv.length) {
      lines = argv[nextIndex];
      index += 1;
    }
    continue;
  }
  if (arg === '--nostream') {
    stream = false;
  }
}

const tailArgs = stream
  ? ['-n', lines, '-f', ...logFiles]
  : ['-n', lines, ...logFiles];

const result = spawnSync('tail', tailArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
