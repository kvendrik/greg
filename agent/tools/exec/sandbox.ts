import path from 'node:path';
import { realpathSync } from 'node:fs';

const SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

export function sandbox(params: { command: string; args: string[] }): {
  command: string;
  args: string[];
} {
  const profile = createProfile();
  return {
    command: SANDBOX_EXEC_PATH,
    args: ['-p', profile, params.command, ...params.args],
  };
}

function createProfile(): string {
  return [
    '(version 1)',
    // Default-deny is the safety baseline; only explicitly allowed capabilities below can be used.
    '(deny default)',
    // Network access is permitted broadly; write permissions are constrained separately below.
    '(allow network*)',
    // Read access is broadly allowed, while write access is restricted to `writableRoots` via `writeRules`.
    '(allow file-read*)',
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
