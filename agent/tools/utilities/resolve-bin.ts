import { accessSync, constants, realpathSync } from 'fs';

const ALLOWED_SEARCH_PATH = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/local/sbin',
];

function findBin(name: string): string | null {
  for (const dir of ALLOWED_SEARCH_PATH) {
    const candidate = `${dir}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function resolveBin(name: string): string {
  const found = findBin(name);
  if (!found) throw new Error(`Binary not found: "${name}"`);

  try {
    return realpathSync(found); // follows all symlinks → canonical path
  } catch {
    throw new Error(`Failed to resolve symlinks for: "${found}"`);
  }
}
