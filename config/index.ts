import type { Config } from './types';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exists } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AgentConfig } from '../agent/types';

export type { Config } from './types';
export { validate } from './validate';
export { link as linkEnv } from './link-env';
export * as exec from './exec-defaults';

type InternalConfig = Config & {
  id: AgentConfig['id'];
  workspace: AgentConfig['workspace'];
};

export const home = join(homedir(), '.greg');
const workspace = join(home, 'workspace');
export const path = join(home, 'config.ts');

export async function get(): Promise<InternalConfig> {
  if (!(await exists(workspace))) {
    await mkdir(workspace, { recursive: true });
  }

  if (!(await exists(path))) {
    throw new Error(`Config file not found at ${path}`);
  }

  // Config is user-specific and usually gitignored. Avoid static module resolution.
  const configModule = await import(pathToFileURL(path).href);
  const globalConfig = (configModule as { default: Config }).default;

  return {
    id: 'greg',
    workspace,
    ...globalConfig,
  };
}

export { getModel } from '@mariozechner/pi-ai';
