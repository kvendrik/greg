import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const HEARTBEAT_DIR = 'heartbeat';
const PAUSED_FILENAME = '.paused';

export function getPausedFilePath(workspacePath: string): string {
  return join(workspacePath, HEARTBEAT_DIR, PAUSED_FILENAME);
}

export async function isHeartbeatPaused(
  workspacePath: string
): Promise<boolean> {
  try {
    await readFile(getPausedFilePath(workspacePath), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function setHeartbeatPaused(
  workspacePath: string,
  paused: boolean
): Promise<void> {
  const path = getPausedFilePath(workspacePath);
  if (paused) {
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Date().toISOString() + '\n', 'utf8');
  } else {
    try {
      await unlink(path);
    } catch {
      // already removed or missing
    }
  }
}
