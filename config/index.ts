import type { Config } from './types';
import { join } from 'node:path';
import { exists } from 'node:fs/promises';

export type { Config } from './types';
export { validate } from './validate';

export const path = join(import.meta.dirname, '..', '.greg.ts');

export async function get(): Promise<Config> {
  if (!(await exists(path))) {
    throw new Error(`Config file not found at ${path}`);
  }

  const config = await import('../.greg');
  return config.default;
}
