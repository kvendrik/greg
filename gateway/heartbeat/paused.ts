import { exists, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { get as getConfig } from '../../config';
import { getWorkspacePath } from '../../agent/utilities';

const HEARTBEAT_DIR = 'heartbeat';
const PAUSED_FILENAME = '.paused';

const config = await getConfig();
const pausedFilePath = join(
  getWorkspacePath(config),
  HEARTBEAT_DIR,
  PAUSED_FILENAME
);

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
