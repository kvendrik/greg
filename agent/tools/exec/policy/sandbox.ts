import { which } from 'bun';
import { AgentConfig } from '../../..';
import { getRoots } from '../../files/filesystem';

export function sandbox(
  params: { command: string; args: string[] },
  config: AgentConfig
): {
  command: string;
  args: string[];
} {
  const profile = createProfile(config);
  const bin = which('sandbox-exec');

  if (!bin) {
    throw new Error('sandbox-exec not found');
  }

  return {
    command: bin,
    args: ['-p', profile, params.command, ...params.args],
  };
}

function createProfile(config: AgentConfig): string {
  const readAllow = getRoots('read', config)
    .allow.map((root) => `(subpath "${root}")`)
    .join(' ');

  const readDeny = getRoots('read', config)
    .deny.map((root) => `(subpath "${root}")`)
    .join(' ');

  const writeAllow = getRoots('write', config)
    .allow.map((root) => `(subpath "${root}")`)
    .join(' ');

  const writeDeny = getRoots('write', config)
    .deny.map((root) => `(subpath "${root}")`)
    .join(' ');

  return [
    '(version 1)',
    '(deny default)',
    '(allow network*)',
    '(allow file-read-metadata)',
    `(allow file-read* ${readAllow})`,
    `(deny file-read* ${readDeny})`,
    `(allow file-write* ${writeAllow})`,
    `(deny file-write* ${writeDeny})`,
  ].join('\n');
}
