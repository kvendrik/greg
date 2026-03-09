import type { AllowList } from '../../../types';

/**
 * Default allowlist for common, low-risk shell commands.
 *
 * Design, inspired by systems like OpenClaw:
 * - We only include a small, curated set of binaries.
 * - We resolve binaries via PATH at evaluation time, so callers can
 *   write portable allowlist entries like "ls" or "git status" without
 *   hardcoding platform-specific paths.
 * - We separate two tiers:
 *   - `trusted: true, allow: true`     → read-only / navigational commands whose
 *     output comes from local filesystem or git metadata (no untrusted external content).
 *   - `trusted: false, allow: true`    → "safe bin" style utilities that are OS-safe
 *     and read-only, but may expose or transform arbitrary data, so their output
 *     is still sent through the guard.
 */
export const defaultExecAllowlist: AllowList = {
  pwd: { trusted: true, allow: true },
  ls: { trusted: true, allow: true },
  echo: { trusted: true, allow: true },
  'ls -la': { trusted: true, allow: true },
  'cd *': { trusted: true, allow: true },

  'git status': { trusted: true, allow: true },
  'git diff': { trusted: true, allow: true },
  'git diff --stat': { trusted: true, allow: true },
  'git log --oneline': { trusted: true, allow: true },
  'git branch': { trusted: true, allow: true },
  'git rev-parse --abbrev-ref HEAD': { trusted: true, allow: true },
  'git rev-parse HEAD': { trusted: true, allow: true },

  'jq *': { trusted: true, allow: true },
  'head *': { trusted: true, allow: true },
  'tail *': { trusted: true, allow: true },
  'wc *': { trusted: true, allow: true },
  'sort *': { trusted: true, allow: true },
  'uniq *': { trusted: true, allow: true },
  'grep *': { trusted: true, allow: true },
  'rg *': { trusted: true, allow: true },
};
