import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';

const projectRoot = path.join(import.meta.dirname, '..', '..');
const gregBin = path.join(projectRoot, 'bin', 'greg.ts');

function runGreg(args: string[]): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync('bun', ['run', gregBin, ...args], {
    cwd: projectRoot,
    encoding: 'utf-8',
    env: { ...process.env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('greg', () => {
  describe('CLI', () => {
    it('prints version with --version', () => {
      const { stdout, status } = runGreg(['--version']);
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('prints help with --help and lists main commands', () => {
      const { stdout, status } = runGreg(['--help']);
      expect(status).toBe(0);
      expect(stdout).toContain('gateway');
      expect(stdout).toContain('cron');
      expect(stdout).toContain('heartbeat');
      expect(stdout).toContain('config');
      expect(stdout).toContain('doctor');
      expect(stdout).toContain('sessions');
    });

    it('gateway subcommand has start, status, stop, restart, logs', () => {
      const { stdout, status } = runGreg(['gateway', '--help']);
      expect(status).toBe(0);
      expect(stdout).toContain('start');
      expect(stdout).toContain('status');
      expect(stdout).toContain('stop');
      expect(stdout).toContain('restart');
      expect(stdout).toContain('logs');
    });

    it('config path prints path containing .greg', () => {
      const { stdout, status } = runGreg(['config', 'path']);
      expect(status).toBe(0);
      expect(stdout).toMatch(/\.greg\.(ts|js)/);
    });

    it('cron --help lists add, list, remove, update, runs, run', () => {
      const { stdout, status } = runGreg(['cron', '--help']);
      expect(status).toBe(0);
      expect(stdout).toContain('add');
      expect(stdout).toContain('list');
      expect(stdout).toContain('remove');
      expect(stdout).toContain('update');
      expect(stdout).toContain('runs');
      expect(stdout).toContain('run');
    });

    it('heartbeat --help lists status, enable, disable, last', () => {
      const { stdout, status } = runGreg(['heartbeat', '--help']);
      expect(status).toBe(0);
      expect(stdout).toContain('status');
      expect(stdout).toContain('enable');
      expect(stdout).toContain('disable');
      expect(stdout).toContain('last');
    });
  });

  describe('cron', () => {
    it('add fails when --prompt is missing', () => {
      const { stderr, status } = runGreg(['cron', 'add']);
      expect(status).not.toBe(0);
      expect(stderr).toContain('--prompt');
    });

    it('add fails when exactly one of --cron, --every, --at is required', () => {
      const { stderr, status } = runGreg([
        'cron',
        'add',
        '--prompt',
        'test',
        '--cron',
        '0 0 18 * * *',
        '--every',
        '60000',
      ]);
      expect(status).toBe(1);
      expect(stderr).toContain('exactly one of');
    });

    it('add fails with invalid cron expression', () => {
      const { stderr, status } = runGreg([
        'cron',
        'add',
        '--cron',
        'invalid',
        '--prompt',
        'test',
      ]);
      expect(status).toBe(1);
      expect(stderr).toMatch(/invalid|error/i);
    });

    it('list runs and prints no jobs or job list', () => {
      const { stdout, status } = runGreg(['cron', 'list']);
      expect(status).toBe(0);
      const hasExpected =
        stdout.includes('No jobs') ||
        stdout.includes('jobs.json') ||
        /job-\d+-/.test(stdout);
      expect(hasExpected).toBe(true);
    });

    it('remove fails with not found for unknown job id', () => {
      const { stderr, status } = runGreg([
        'cron',
        'remove',
        'nonexistent-job-id-12345',
      ]);
      expect(status).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('heartbeat', () => {
    it('status --json outputs valid JSON with enabled, paused, runs', () => {
      const { stdout, status } = runGreg(['heartbeat', 'status', '--json']);
      expect(status).toBe(0);
      const data = JSON.parse(stdout) as {
        enabled?: boolean;
        paused?: boolean;
        runs?: unknown[];
      };
      expect(typeof data.enabled).toBe('boolean');
      expect(typeof data.paused).toBe('boolean');
      expect(Array.isArray(data.runs)).toBe(true);
    });

    it('last --json outputs null or run object', () => {
      const { stdout, status } = runGreg(['heartbeat', 'last', '--json']);
      expect(status).toBe(0);
      const data = JSON.parse(stdout) as null | {
        startedAt?: string;
        finishedAt?: string;
        success?: boolean;
      };
      if (data !== null) {
        expect(data).toHaveProperty('startedAt');
        expect(data).toHaveProperty('finishedAt');
        expect(typeof data.success).toBe('boolean');
      }
    });
  });

  describe('config', () => {
    it('validate runs when config exists', () => {
      const { status } = runGreg(['config', 'validate']);
      expect([0, 1]).toContain(status ?? 0);
    });
  });
});
