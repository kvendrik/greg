import type { AllowList } from './allowlist';

export const defaultExecAllowlist: AllowList = {
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

  'git status *': { allow: true },
  'git diff *': { allow: true },
  'git log *': { allow: true },
  'git branch *': { allow: true },
  'git rev-parse *': { allow: true },

  'jq *': { allow: true },
  'head *': { allow: true },
  'tail *': { allow: true },
  'wc *': { allow: true },
  'sort *': { allow: true },
  'uniq *': { allow: true },
  'grep *': { allow: true },
  'rg *': { allow: true },
  'cat *': { allow: true },
};
