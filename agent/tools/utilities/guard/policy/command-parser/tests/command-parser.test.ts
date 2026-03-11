import { describe, expect, it } from 'bun:test';
import type { CommandChainOperator } from '../command-parser';
import { parseCommand } from '../command-parser';

type SegmentExpectation = {
  raw: string;
  argv: string[];
  command: string | null;
  subcommands: string[];
  commandWithSubcommands: string;
  /**
   * Whether we expect the parser to successfully resolve this command
   * to an executable on PATH (resolvedCommandPath !== null).
   */
  expectResolvedCommandPath: boolean;
};

type CommandTestCase = {
  title: string;
  input: string;
  expectedSegments: SegmentExpectation[];
  expectedOperators: string[];
};

const tests: CommandTestCase[] = [
  {
    title: 'simple command with args',
    input: 'ls -la /tmp',
    expectedSegments: [
      {
        raw: 'ls -la /tmp',
        argv: ['ls', '-la', '/tmp'],
        command: 'ls',
        subcommands: ['-la'],
        commandWithSubcommands: 'ls -la',
        expectResolvedCommandPath: true,
      },
    ],
    expectedOperators: [],
  },
  {
    title: 'command with subcommand and flag',
    input: 'git status -sb',
    expectedSegments: [
      {
        raw: 'git status -sb',
        argv: ['git', 'status', '-sb'],
        command: 'git',
        subcommands: ['status', '-sb'],
        commandWithSubcommands: 'git status -sb',
        expectResolvedCommandPath: true,
      },
    ],
    expectedOperators: [],
  },
  {
    title: 'multiple segments with operators',
    input: 'ls -la && git status -sb || echo "done"; pwd',
    expectedSegments: [
      {
        raw: 'ls -la ',
        argv: ['ls', '-la'],
        command: 'ls',
        subcommands: ['-la'],
        commandWithSubcommands: 'ls -la',
        expectResolvedCommandPath: true,
      },
      {
        raw: ' git status -sb ',
        argv: ['git', 'status', '-sb'],
        command: 'git',
        subcommands: ['status', '-sb'],
        commandWithSubcommands: 'git status -sb',
        expectResolvedCommandPath: true,
      },
      {
        raw: ' echo "done"',
        argv: ['echo', 'done'],
        command: 'echo',
        subcommands: ['done'],
        commandWithSubcommands: 'echo done',
        expectResolvedCommandPath: true,
      },
      {
        raw: ' pwd',
        argv: ['pwd'],
        command: 'pwd',
        subcommands: [],
        commandWithSubcommands: 'pwd',
        expectResolvedCommandPath: true,
      },
    ],
    expectedOperators: ['&&', '||', ';'],
  },
  {
    title: 'subcommand with dashes and numbers',
    input: 'tool sub-command-1 extra-arg --flag',
    expectedSegments: [
      {
        raw: 'tool sub-command-1 extra-arg --flag',
        argv: ['tool', 'sub-command-1', 'extra-arg', '--flag'],
        command: 'tool',
        subcommands: ['sub-command-1', 'extra-arg', '--flag'],
        commandWithSubcommands: 'tool sub-command-1 extra-arg --flag',
        // "tool" is a placeholder and may not exist on PATH.
        expectResolvedCommandPath: false,
      },
    ],
    expectedOperators: [],
  },
];

function segmentsEqual(
  actual: SegmentExpectation,
  expected: SegmentExpectation
): boolean {
  return (
    actual.raw === expected.raw &&
    JSON.stringify(actual.argv) === JSON.stringify(expected.argv) &&
    actual.command === expected.command &&
    JSON.stringify(actual.subcommands) === JSON.stringify(expected.subcommands) &&
    actual.commandWithSubcommands === expected.commandWithSubcommands
  );
}

describe('command parser', () => {
  describe('parseCommand()', () => {
    for (const test of tests) {
      it(test.title, () => {
        const parsed = parseCommand(test.input);

        expect(parsed.segments.length).toBe(test.expectedSegments.length);

        parsed.segments.forEach((segment, idx) => {
          const expected = test.expectedSegments[idx]!;
          const actual: SegmentExpectation = {
            raw: segment.raw,
            argv: segment.argv,
            command: segment.command,
            subcommands: segment.subcommands,
            commandWithSubcommands: segment.commandWithSubcommands,
            expectResolvedCommandPath: expected.expectResolvedCommandPath,
          };

          expect(segmentsEqual(actual, expected)).toBe(true);

          const resolved = segment.resolvedCommandPath;
          if (expected.expectResolvedCommandPath) {
            expect(resolved).not.toBeNull();
          } else {
            expect(resolved).toBeNull();
          }
        });

      expect(parsed.operators).toEqual(
        test.expectedOperators as CommandChainOperator[]
      );
      });
    }
  });
});

