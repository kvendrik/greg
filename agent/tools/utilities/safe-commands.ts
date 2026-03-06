const ALLOWED_COMMANDS: Record<string, true | Set<string>> = {
  // File system
  ls: true,
  find: true,
  cat: true,
  head: true,
  tail: true,
  file: true,
  stat: true,
  du: true,
  df: true,
  pwd: true,
  realpath: true,
  dirname: true,
  basename: true,

  // Text processing
  grep: true,
  sed: true,
  awk: true,
  cut: true,
  sort: true,
  uniq: true,
  wc: true,
  tr: true,
  diff: true,
  patch: true,
  xargs: true,
  tee: true,
  column: true,

  // File operations
  cp: true,
  mv: true,
  mkdir: true,
  rmdir: true,
  touch: true,
  chmod: true,
  chown: true,
  ln: true,
  rm: true,

  // Archives
  zip: true,
  unzip: true,
  tar: true,
  gzip: true,
  gunzip: true,
  bzip2: true,
  zcat: true,

  // Processes
  ps: true,
  kill: true,
  killall: true,
  lsof: true,
  pgrep: true,
  pkill: true,

  // Output
  echo: true,
  printf: true,

  // Dev tools
  jq: true,
  yq: true,
  xmllint: true,

  // System info
  uname: true,
  sw_vers: true,
  sysctl: true,
  uptime: true,
  date: true,
  whoami: true,
  id: true,
  env: true,
  which: true,
  greg: true,

  // Git - subcommands only, no network ops
  git: new Set([
    'status',
    'log',
    'diff',
    'show',
    'branch',
    'add',
    'commit',
    'checkout',
    'switch',
    'merge',
    'rebase',
    'stash',
    'reset',
    'restore',
    'tag',
    'blame',
    'shortlog',
    'describe',
  ]),
};

export function isCommandAllowed(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const rule = ALLOWED_COMMANDS[cmd];

  if (!rule) return false;
  if (rule === true) return true;

  // For subcommand-restricted tools, find the first non-flag argument
  const subcommand = parts.slice(1).find((arg) => !arg.startsWith('-'));
  if (!subcommand) return false;

  return rule.has(subcommand);
}
