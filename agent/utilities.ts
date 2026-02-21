import { homedir } from 'node:os';
import { join } from 'node:path';

export function getWorkspacePath(): string {
  const raw = process.env.WORKSPACE_PATH;
  if (!raw) {
    throw new Error('WORKSPACE_PATH is not set');
  }
  if (raw.startsWith('~/') || raw === '~') {
    return join(homedir(), raw.slice(1));
  }
  return raw;
}
