import { homedir } from 'node:os';
import { join } from 'node:path';

/** Format an ISO date string for display (weekday, date, time) in the current timezone. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
}

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
