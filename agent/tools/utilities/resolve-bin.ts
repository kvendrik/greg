import path from 'node:path';
import os from 'node:os';
import { accessSync, constants, realpathSync } from 'fs';

export function safePath(): string {
  const bunUserBin = path.join(os.homedir(), '.bun', 'bin');
  return [
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    bunUserBin,
  ].join(':');
}

function findBin(name: string): string | null {
  for (const dir of safePath().split(':')) {
    if (dir.trim() === '') continue;
    const candidate = `${dir}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Ignore permission/access errors while searching.
    }
  }
  return null;
}

function expandTilde(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveBin(name: string): string {
  const expandedName = expandTilde(name);
  const looksLikePath =
    path.isAbsolute(expandedName) || expandedName.includes('/');

  // If the caller already provided a path (e.g. "/usr/bin/curl"), validate it
  // directly instead of searching for "dir//usr/bin/curl".
  if (looksLikePath) {
    accessSync(expandedName, constants.X_OK);
    try {
      return realpathSync(expandedName); // follows symlinks → canonical path
    } catch {
      return expandedName;
    }
  }

  const found = findBin(name);
  if (!found) throw new Error(`Binary not found: "${name}"`);

  try {
    return realpathSync(found); // follows all symlinks → canonical path
  } catch {
    throw new Error(`Failed to resolve symlinks for: "${found}"`);
  }
}
