import type { Config } from './types';
import { join } from 'node:path';
import { exists } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export type { Config } from './types';
export { validate } from './validate';
export { link as linkEnv } from './link-env';
export * as exec from './exec-profiles';

export const path = join(import.meta.dirname, '..', '.greg.ts');

export async function get(): Promise<Config> {
  if (!(await exists(path))) {
    throw new Error(`Config file not found at ${path}`);
  }

  // Config is user-specific and usually gitignored. Avoid static module resolution.
  const configModule = await import(pathToFileURL(path).href);
  return (configModule as { default: Config }).default;
}
