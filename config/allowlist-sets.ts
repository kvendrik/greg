import type { AllowList } from '../agent/tools/utilities/policy/allowlist';

/**
 * Read-only commands only. No writes to disk, no fetching from the network.
 * Excludes e.g. curl, wget, git fetch, git pull, npm install.
 */
export const readOnlyCommands: AllowList = {
  'pwd *': { allow: true },
  'ls *': { allow: true },
  'echo *': { allow: true },
  'cd *': { allow: true },
  'printf *': { allow: true },

  'greg logs *': { allow: true },
  'greg gateway *': { allow: true },
  'greg heartbeat *': { allow: true },
  'greg doctor': { allow: true },
  'greg config *': { allow: true },
  'greg sessions *': { allow: true },
  'greg skills *': { allow: true },

  'git status *': { allow: true },
  'git diff *': { allow: true },
  'git log *': { allow: true },
  'git branch *': { allow: true },
  'git rev-parse *': { allow: true },
  'git show *': { allow: true },

  'head *': { allow: true },
  'tail *': { allow: true },
  'wc *': { allow: true },
  'uniq *': { allow: true },
  'grep *': { allow: true },
  'rg *': { allow: true },
  'cat *': { allow: true },

  'which *': { allow: true },
  'file *': { allow: true },
  'stat *': { allow: true },
  'readlink *': { allow: true },
  'whoami': { allow: true },
  'id *': { allow: true },
  'env *': { allow: true },
  'date *': { allow: true },
  'hostname': { allow: true },
  'uname *': { allow: true },
  'diff *': { allow: true },
  'cut *': { allow: true },
  'tr *': { allow: true },
  'nl *': { allow: true },
  'seq *': { allow: true },
  'du *': { allow: true },
  'df *': { allow: true },
  'tree *': { allow: true },
};
