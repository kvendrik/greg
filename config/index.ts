import type { Config } from './types';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { exists, mkdir, writeFile } from 'node:fs/promises';
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

export const home = process.env.TEST_ENV
  ? join(tmpdir(), '.greg')
  : join(homedir(), '.greg');

const workspace = join(home, 'workspace');
export const path = join(home, 'config.ts');

/** Minimal config for automated runs; must load as ESM (dynamic import). */
const CI_DEFAULT_CONFIG_TS = `export default {
  models: [],
  tools: { guard: { enabled: true, ask: false } },
  heartbeat: { enabled: false },
};
`;

export async function get(): Promise<InternalConfig> {
  if (!(await exists(workspace))) {
    await mkdir(workspace, { recursive: true });
  }

  if (!(await exists(path))) {
    if (process.env.TEST_ENV) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, CI_DEFAULT_CONFIG_TS, 'utf8');
    } else {
      throw new Error(`Config file not found at ${path}`);
    }
  }

  // Config is user-specific and usually gitignored. Avoid static module resolution.
  const configModule: unknown = await import(pathToFileURL(path).href);
  if (
    typeof configModule !== 'object' ||
    configModule === null ||
    !('default' in configModule)
  ) {
    throw new Error(`Invalid config module shape at ${path}`);
  }
  const defaultExport = (configModule as { default: unknown }).default;
  if (typeof defaultExport !== 'object' || defaultExport === null) {
    throw new Error(`Config default export must be an object at ${path}`);
  }
  const globalConfig = defaultExport as Config;

  return {
    id: 'greg',
    workspace,
    ...globalConfig,
  };
}

export { getModel } from '@mariozechner/pi-ai';
