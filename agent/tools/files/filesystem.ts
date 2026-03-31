import { resolve, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { AgentConfig } from '../../types';
import { getWorkspacePath } from '../../utilities';

const projectRoot = resolve(join(__dirname, '../../../'));

const getDefaultAllowedPaths = (config: AgentConfig): { write: string[] } => ({
  write: [
    resolve(getWorkspacePath(config)),
    tmpdir(),
    projectRoot,
    `!${join(projectRoot, 'agent')}`,
  ],
});

export function isAllowed(path: string, config: AgentConfig): boolean {
  const absolutePath = resolve(expandPath(path));
  return get('write');

  function get(action: 'write'): boolean {
    const all = getRoots(action, config);
    return (
      all.allow.some((root) => absolutePath.startsWith(root)) &&
      !all.deny.some((root) => absolutePath.startsWith(root))
    );
  }
}

export function getRoots(
  forAction: 'write',
  config: AgentConfig
): {
  allow: string[];
  deny: string[];
} {
  const guardFiles = config.tools.guard.files;
  const extraPaths =
    guardFiles === undefined ? [] : guardFiles[forAction].map(expandPath);
  const all = [...getDefaultAllowedPaths(config)[forAction], ...extraPaths];
  return {
    allow: all.filter((root) => !root.startsWith('!')),
    deny: all
      .filter((root) => root.startsWith('!'))
      .map((root) => root.slice(1)),
  };
}

export function expandPath(path: string): string {
  return resolve(path.replace('~', homedir()));
}
