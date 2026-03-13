import { exists, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';
import config from '../../.greg';

const HEARTBEAT_DIR = 'heartbeat';
const PAUSED_FILENAME = '.paused';

const pausedFilePath = join(config.workspace, HEARTBEAT_DIR, PAUSED_FILENAME);

export async function isPaused(): Promise<boolean> {
  return exists(pausedFilePath);
}

export async function setPaused(paused: boolean): Promise<void> {
  if (paused) {
    await mkdir(dirname(pausedFilePath), { recursive: true });
    await writeFile(pausedFilePath, new Date().toISOString() + '\n', 'utf8');
  } else {
    await unlink(pausedFilePath);
  }
}
