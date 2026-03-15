import type { AllowList } from '../allowlist';
import type { AgentConfig } from '../../../../types';
import { describe, expect, it } from 'bun:test';
import { getAllowlistForCommand } from '../allowlist';

const mockConfig = (allowlist: AllowList): AgentConfig =>
  ({
    id: 'test',
    workspace: '',
    port: '3000',
    models: [],
    tools: {
      guard: {
        enabled: true,
      },
    },
    allowlist,
  }) as AgentConfig;

type TestCase = {
  title: string;
  allowlist: AllowList;
  command: string;
  expected: {
    allow: boolean;
    trusted?: boolean;
  };
};

const tests: TestCase[] = [
  {
    title: 'single allowed base command with args',
    allowlist: {
      ls: {  allow: true },
    },
    command: 'ls -la /tmp',
    expected: { allow: true },
  },
  {
    title: 'allowing base command doesn’t allow subcommands',
    allowlist: {
      something: {  allow: true },
    },
    command: 'something else',
    expected: { allow: false },
  },
  {
    title: 'allowing subcommands',
    allowlist: {
      'git status': {  allow: true },
    },
    command: 'git status',
    expected: { allow: true },
  },
  {
    title:
      'allowing subcommand plus default wildcard allows more than specified',
    allowlist: {
      'git status': {  allow: true },
    },
    command: 'git status diff',
    expected: { allow: true },
  },
  {
    title: 'ignores env variables',
    allowlist: {
      'gog calendar events *': {  allow: true },
    },
    command:
      'GOG_ACCOUNT=example@gmail.com gog calendar events primary --today',
    expected: { allow: true },
  },
  {
    title: 'ignores pipes',
    allowlist: {
      'gog calendar events *': {  allow: true },
    },
    command:
      'GOG_ACCOUNT=example@gmail.com gog calendar events primary --today --json 2>/dev/null',
    expected: { allow: true },
  },
  {
    title:
      'allowing subcommand does allow more than specified when wildcard is used',
    allowlist: {
      'git status *': {  allow: true },
    },
    command: 'git status diff',
    expected: { allow: true },
  },
  {
    title: 'single allowed base command without args',
    allowlist: {
      cat: {  allow: true },
    },
    command: 'cat "./skills/update/SKILL.md"',
    expected: { allow: true },
  },
  {
    title:
      'default allowlist entries still apply when config exec allowlist is present',
    allowlist: {
      'bun run *': {  allow: true },
    },
    command: 'cat "./skills/status-update/SKILL.md"',
    expected: { allow: true },
  },
  {
    title: 'single disallowed base command',
    allowlist: {
      'ls *': { allow: false },
    },
    command: 'ls -la /tmp',
    expected: { allow: false },
  },
  {
    title: 'multiple segments where all are allowed',
    allowlist: {
      ls: {  allow: true },
      pwd: { trusted: true, allow: true },
    },
    command: 'ls -la && pwd',
    expected: { allow: true },
  },
  {
    title: 'multiple segments where one is disallowed',
    allowlist: {
      ls: { allow: true },
    },
    command: 'ls -la && rm -rf /',
    expected: { allow: false },
  },
  {
    title: 'wildcard subcommand match for npm run',
    allowlist: {
      'npm run *': {  allow: true },
    },
    command: 'npm run build --watch',
    expected: { allow: true },
  },
  {
    title:
      'wildcard and exact matches combined for multi-segment command (all allowed)',
    allowlist: {
      'npm run *': {  allow: true },
      'git status': { trusted: true, allow: true },
    },
    command: 'npm run dev && git status -sb',
    expected: { allow: true },
  },
  {
    title: 'allow wildcard to be used inside subcommands',
    allowlist: {
      'bun run hub/*': { trusted: true, allow: true },
    },
    command:
      'bun run hub/notion -- search -q "diary" --page-only 2>/dev/null | head -20',
    expected: { allow: true },
  },
  {
    title: 'wildcards inside subcommands only match what they’re supposed to',
    allowlist: {
      'bun run hub/*': { trusted: true, allow: true },
    },
    command: 'bun run hub_root/dangerous -- search_secrets',
    expected: { allow: false },
  },
  {
    title:
      'wildcard and exact matches combined for multi-segment command (one denied)',
    allowlist: {
      'npm run *': { allow: true },
      'git status': { trusted: true, allow: false },
    },
    command: 'npm run dev && git status -sb',
    expected: { allow: false },
  },
  {
    title: 'trusted flag only true when all segments are trusted and allowed',
    allowlist: {
      ls: { trusted: true, allow: true },
      pwd: { trusted: true, allow: true },
    },
    command: 'ls && pwd',
    expected: { allow: true, trusted: true },
  },
  {
    title: 'trusted flag becomes false when any allowed segment is not trusted',
    allowlist: {
      ls: { trusted: true, allow: true },
      pwd: { allow: true },
    },
    command: 'ls && pwd',
    expected: { allow: true, trusted: false },
  },
  {
    title: 'direct full-command match still works',
    allowlist: {
      'ls -la': {  allow: true },
    },
    command: 'ls -la',
    expected: { allow: true },
  },
  {
    title: 'direct full multi-segment match does not grant unsafe segment',
    allowlist: {
      'safe && rm -rf /': { trusted: true, allow: true },
      safe: { trusted: true, allow: true },
    },
    command: 'safe && rm -rf /',
    expected: { allow: false },
  },
  {
    title: 'wildcard cd into any directory',
    allowlist: {
      'cd *': {  allow: true },
    },
    command: 'cd /var/log',
    expected: { allow: true },
  },
  {
    title: 'wildcard match for safe_command',
    allowlist: {
      'safe_command *': { allow: true },
    },
    command: 'safe_command yeah && hello ok',
    expected: { allow: false },
  },
  {
    title: 'full-path git status with subcommand parsing',
    allowlist: {
      '/usr/bin/git status': { trusted: true, allow: true },
    },
    command: '/usr/bin/git status -sb',
    expected: { allow: true },
  },
  {
    title: 'bare git status resolved to full-path entry',
    allowlist: {
      '/usr/bin/git status': { trusted: true, allow: true },
    },
    command: 'git status -sb',
    expected: { allow: true },
  },
  {
    title: 'full-path git rev-parse subcommand',
    allowlist: {
      '/usr/bin/git rev-parse --abbrev-ref HEAD': {
        trusted: true,
        allow: true,
      },
    },
    command: '/usr/bin/git rev-parse --abbrev-ref HEAD',
    expected: { allow: true },
  },
  {
    title: 'allowing wildcard doesn’t mean you can’t run the basecommand',
    allowlist: {
      'jq *': { trusted: true, allow: true },
    },
    command: 'jq',
    expected: { allow: true },
  },
  {
    title: 'full-path safe bin wildcard jq',
    allowlist: {
      '/usr/bin/jq *': { trusted: true, allow: true },
    },
    command: '/usr/bin/jq .',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows pwd',
    allowlist: {} as AllowList,
    command: 'pwd',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows ls with args',
    allowlist: {} as AllowList,
    command: 'ls -la',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows echo with args',
    allowlist: {} as AllowList,
    command: 'echo "hello world"',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows cd anywhere',
    allowlist: {} as AllowList,
    command: 'cd /tmp',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows printf with args',
    allowlist: {} as AllowList,
    command: 'printf "%s\\n" hello',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows greg commands',
    allowlist: {} as AllowList,
    command: 'greg guard status',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows git status with flags',
    allowlist: {} as AllowList,
    command: 'git status -sb',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows git diff with args',
    allowlist: {} as AllowList,
    command: 'git diff HEAD~1',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows git log with flags',
    allowlist: {} as AllowList,
    command: 'git log --oneline',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows git branch with flags',
    allowlist: {} as AllowList,
    command: 'git branch -a',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows git rev-parse with args',
    allowlist: {} as AllowList,
    command: 'git rev-parse HEAD',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows jq',
    allowlist: {} as AllowList,
    command: 'jq .',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows head',
    allowlist: {} as AllowList,
    command: 'head -10 file.txt',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows tail',
    allowlist: {} as AllowList,
    command: 'tail -10 file.txt',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows wc',
    allowlist: {} as AllowList,
    command: 'wc -l file.txt',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows sort',
    allowlist: {} as AllowList,
    command: 'sort file.txt',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows uniq',
    allowlist: {} as AllowList,
    command: 'uniq file.txt',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows grep',
    allowlist: {} as AllowList,
    command: 'grep foo file.txt',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows rg',
    allowlist: {} as AllowList,
    command: 'rg foo',
    expected: { allow: true },
  },
  {
    title: 'default allowlist allows cat',
    allowlist: {} as AllowList,
    command: 'cat file.txt',
    expected: { allow: true },
  },
  {
    title:
      'config allowlist can override default wildcard to deny ls with args',
    allowlist: {
      ls: { allow: false },
    },
    command: 'ls -la',
    expected: { allow: false },
  },
  {
    title:
      'config allowlist exact entry overrides default wildcard but keeps other defaults',
    allowlist: {
      'git status': { allow: false },
    },
    command: 'git status -sb && git log --oneline',
    expected: { allow: false },
  },
  {
    title:
      'when both wildcard and exact entries match, both must allow and be trusted',
    allowlist: {
      'git status *': { trusted: true, allow: true },
      'git status -sb': { trusted: true, allow: true },
    },
    command: 'git status -sb',
    expected: { allow: true, trusted: true },
  },
];

describe('allowlist', () => {
  describe('getAllowlistForCommand()', () => {
    for (const test of tests) {
      it(test.title, () => {
        const config = mockConfig(test.allowlist);
        const result = getAllowlistForCommand(test.command, config);

        expect(result.allow).toBe(test.expected.allow);
        if ('trusted' in test.expected) {
          expect(result.trusted).toBe(test.expected.trusted);
        }
      });
    }
  });
});
