import type { AllowList } from '../../../../types';

export const defaultExecAllowlist: AllowList = {
  'pwd *': { trusted: true, allow: true },
  'ls *': { trusted: true, allow: true },
  'echo *': { trusted: true, allow: true },
  'cd *': { trusted: true, allow: true },
  'printf *': { trusted: true, allow: true },
  'greg *': { trusted: true, allow: true },

  'git status *': { trusted: true, allow: true },
  'git diff *': { trusted: true, allow: true },
  'git log *': { trusted: true, allow: true },
  'git branch *': { trusted: true, allow: true },
  'git rev-parse *': { trusted: true, allow: true },

  'jq *': { trusted: true, allow: true },
  'head *': { trusted: true, allow: true },
  'tail *': { trusted: true, allow: true },
  'wc *': { trusted: true, allow: true },
  'sort *': { trusted: true, allow: true },
  'uniq *': { trusted: true, allow: true },
  'grep *': { trusted: true, allow: true },
  'rg *': { trusted: true, allow: true },
  'cat *': { trusted: true, allow: true },
};
