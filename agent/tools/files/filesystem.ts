import { resolve, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { AgentConfig } from '../../types';
import { getWorkspacePath } from '../../utilities';

const getDefaultAllowedPaths = (config: AgentConfig): string[] => [
  resolve(getWorkspacePath(config)),
  resolve(join(tmpdir(), 'greg')),
];

export function isAllowed(
  forAction: 'read' | 'write' | 'read-write',
  path: string,
  config: AgentConfig
): boolean {
  const absolutePath = resolve(expandPath(path));

  if (forAction === 'read') {
    return get('read');
  }

  if (forAction === 'write') {
    return get('write');
  }

  return get('read') && get('write');

  function get(action: 'read' | 'write') {
    const all = getRoots(action, config);
    return (
      all.allow.some((root) => absolutePath.startsWith(root)) &&
      !all.deny.some((root) => absolutePath.startsWith(root))
    );
  }
}

export function getRoots(
  forAction: 'read' | 'write',
  config: AgentConfig
): {
  allow: string[];
  deny: string[];
} {
  const all = [
    ...getDefaultAllowedPaths(config),
    ...(config.tools?.guard?.files?.[forAction].map(expandPath) ?? []),
  ];
  return {
    allow: all.filter((root) => !root.startsWith('!')),
    deny: all.filter((root) => root.startsWith('!')),
  };
}

export function expandPath(path: string): string {
  return resolve(path.replace('~', homedir()));
}
