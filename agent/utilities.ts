import { homedir } from 'node:os';
import { join } from 'node:path';

export function getWorkspacePath(): string {
  const raw = process.env.WORKSPACE_PATH ?? join(homedir(), '.pa-agent');
  if (raw.startsWith('~/') || raw === '~') {
    return join(homedir(), raw.slice(1));
  }
  return raw;
}
