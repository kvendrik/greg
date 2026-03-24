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
      expect(stdout).toContain('.greg');
      expect(stdout.trim()).toMatch(/config\.(ts|js)$/);
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
