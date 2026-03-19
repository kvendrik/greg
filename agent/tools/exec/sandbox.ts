import path from 'node:path';
import { realpathSync } from 'node:fs';

const SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

export function sandbox(params: {
  command: string;
  args: string[];
  writableRoots: string[];
}): { command: string; args: string[] } {
  const profile = generateSbpl(params.writableRoots);
  return {
    command: SANDBOX_EXEC_PATH,
    args: ['-p', profile, params.command, ...params.args],
  };
}

function generateSbpl(writableRoots: string[]): string {
  const writeRules = writableRoots
    .map((root) => {
      const resolved = resolveForSbpl(root);
      return `(allow file-write* (subpath "${escapeSbpl(resolved)}"))`;
    })
    .join('\n');

  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal)',
    '(allow sysctl*)',
    '(allow mach*)',
    '(allow ipc*)',
    '(allow network*)',
    '(allow system-socket)',
    '(allow file-read*)',
    writeRules,
    '(allow file-write* (subpath "/dev"))',
    '(allow file-write* (regex #"^/private/var/folders/"))',
  ].join('\n');
}

/**
 * Resolve a path to its canonical form for SBPL rules.
 * macOS `/tmp` → `/private/tmp`, so sandbox rules must use the real path.
 * Falls back to resolving the parent when the leaf doesn't exist yet.
 */
function resolveForSbpl(inputPath: string): string {
  try {
    return realpathSync(inputPath);
  } catch {
    const parent = path.dirname(inputPath);
    try {
      return path.join(realpathSync(parent), path.basename(inputPath));
    } catch {
      return path.resolve(inputPath);
    }
  }
}

function escapeSbpl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
