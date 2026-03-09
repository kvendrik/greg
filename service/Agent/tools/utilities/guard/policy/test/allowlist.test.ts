import { describe, expect, it } from 'bun:test';
import type { AgentConfig, AllowList } from '../../../../../types';
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
        use: 'all',
        allowlist: {
          exec: allowlist,
        },
      },
    },
  }) as AgentConfig;

type TestCase = {
  title: string;
  allowlist: AllowList;
  command: string;
  expected: {
    allow: boolean;
    trusted: boolean;
  };
};

const tests: TestCase[] = [
  {
    title: 'single allowed base command with args',
    allowlist: {
      ls: { trusted: false, allow: true },
    },
    command: 'ls -la /tmp',
    expected: { allow: true, trusted: false },
  },
  {
    title: 'single disallowed base command',
    allowlist: {
      ls: { trusted: false, allow: false },
    },
    command: 'ls -la /tmp',
    expected: { allow: false, trusted: false },
  },
  {
    title: 'multiple segments where all are allowed',
    allowlist: {
      ls: { trusted: false, allow: true },
      pwd: { trusted: true, allow: true },
    },
    command: 'ls -la && pwd',
    expected: { allow: true, trusted: false },
  },
  {
    title: 'multiple segments where one is disallowed',
    allowlist: {
      ls: { trusted: false, allow: true },
    },
    command: 'ls -la && rm -rf /',
    expected: { allow: false, trusted: false },
  },
  {
    title: 'wildcard subcommand match for npm run',
    allowlist: {
      'npm run *': { trusted: false, allow: true },
    },
    command: 'npm run build --watch',
    expected: { allow: true, trusted: false },
  },
  {
    title:
      'wildcard and exact matches combined for multi-segment command (all allowed)',
    allowlist: {
      'npm run *': { trusted: false, allow: true },
      'git status': { trusted: true, allow: true },
    },
    command: 'npm run dev && git status -sb',
    expected: { allow: true, trusted: false },
  },
  {
    title:
      'wildcard and exact matches combined for multi-segment command (one denied)',
    allowlist: {
      'npm run *': { trusted: false, allow: true },
      'git status': { trusted: true, allow: false },
    },
    command: 'npm run dev && git status -sb',
    expected: { allow: false, trusted: false },
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
      pwd: { trusted: false, allow: true },
    },
    command: 'ls && pwd',
    expected: { allow: true, trusted: false },
  },
  {
    title: 'direct full-command match still works',
    allowlist: {
      'ls -la': { trusted: false, allow: true },
    },
    command: 'ls -la',
    expected: { allow: true, trusted: false },
  },
  {
    title: 'direct full multi-segment match does not grant unsafe segment',
    allowlist: {
      'safe && rm -rf /': { trusted: true, allow: true },
      safe: { trusted: true, allow: true },
    },
    command: 'safe && rm -rf /',
    expected: { allow: false, trusted: false },
  },
  {
    title: 'wildcard cd into any directory',
    allowlist: {
      'cd *': { trusted: false, allow: true },
    },
    command: 'cd /var/log',
    expected: { allow: true, trusted: false },
  },
  {
    title: 'wildcard match for safe_command',
    allowlist: {
      'safe_command *': { trusted: false, allow: true },
    },
    command: 'safe_command yeah && hello ok',
    expected: { allow: false, trusted: false },
  },
  {
    title: 'full-path git status with subcommand parsing',
    allowlist: {
      '/usr/bin/git status': { trusted: true, allow: true },
    },
    command: '/usr/bin/git status -sb',
    expected: { allow: true, trusted: true },
  },
  {
    title: 'bare git status resolved to full-path entry',
    allowlist: {
      '/usr/bin/git status': { trusted: true, allow: true },
    },
    command: 'git status -sb',
    expected: { allow: true, trusted: true },
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
    expected: { allow: true, trusted: true },
  },
  {
    title: 'full-path safe bin wildcard jq',
    allowlist: {
      '/usr/bin/jq *': { trusted: false, allow: true },
    },
    command: '/usr/bin/jq .',
    expected: { allow: true, trusted: false },
  },
];

describe('allowlist', () => {
  describe('getAllowlistForCommand()', () => {
    for (const test of tests) {
      it(test.title, () => {
        const config = mockConfig(test.allowlist);
        const result = getAllowlistForCommand(test.command, config);

        expect(result.allow).toBe(test.expected.allow);
        expect(result.trusted).toBe(test.expected.trusted);
      });
    }
  });
});

