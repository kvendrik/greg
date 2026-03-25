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

function seatbeltDenySubpaths(roots: string[]): string {
  return roots
    .map((root) => {
      const path = root.startsWith('!') ? root.slice(1) : root;
      return `(subpath "${path}")`;
    })
    .join(' ');
}

function createProfile(config: AgentConfig): string {
  const readDeny = seatbeltDenySubpaths(getRoots('read', config).deny);

  const writeAllow = getRoots('write', config)
    .allow.map((root) => `(subpath "${root}")`)
    .join(' ');

  const writeDeny = seatbeltDenySubpaths(getRoots('write', config).deny);

  // Exec’d processes must read system binaries, dylibs, certs, etc. Keep secrecy
  // paths blocked via tools.guard.files read deny (`!…` entries).
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow network*)',
    '(allow file-read-metadata)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target self))',
    '(allow file-read*)',
  ];
  if (readDeny.length > 0) {
    lines.push(`(deny file-read* ${readDeny})`);
  }
  lines.push(`(allow file-write* ${writeAllow})`);
  if (writeDeny.length > 0) {
    lines.push(`(deny file-write* ${writeDeny})`);
  }
  return lines.join('\n');
}
