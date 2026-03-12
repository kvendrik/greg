import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { startHeartbeat } from '../runner';

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'heartbeat-runner-test-'));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('heartbeat', () => {
  describe('startHeartbeat()', () => {
    it('returns no-op stop when options.enabled is false', () => {
      const stop = startHeartbeat(
        { workspace: join(tmpdir(), 'heartbeat-runner-test') },
        async () => {}
      );
      expect(typeof stop).toBe('function');
      stop();
      // No throw; calling again is safe
      stop();
    });

    it('reads HEARTBEAT.md and calls callback with prompt containing instruction, "---", and checklist content', async () => {
      const dir = await createTempDir();
      const checklist = '- Check inbox\n- Light check-in if daytime';
      await writeFile(join(dir, 'HEARTBEAT.md'), checklist, 'utf8');
      const calls: { prompt: string; opts?: unknown }[] = [];
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs: 50, jitterMs: 0 } },
        async (prompt, opts) => {
          calls.push({ prompt, opts });
        }
      );
      await wait(200);
      stop();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const first = calls[0]!;
      expect(first.prompt).toContain('heartbeat check');
      expect(first.prompt).toContain('---');
      expect(first.prompt).toContain('Check inbox');
      expect(first.opts).toBeDefined();
      expect(
        (first.opts as { ackMaxChars?: number }).ackMaxChars
      ).toBeDefined();
    });

    it('uses "(No checklist items...)" when HEARTBEAT.md is missing or empty', async () => {
      const dir = await createTempDir();
      const calls: { prompt: string }[] = [];
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs: 50, jitterMs: 0 } },
        async (prompt) => {
          calls.push({ prompt });
        }
      );
      await wait(200);
      stop();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]!.prompt).toContain('No checklist items');
      expect(calls[0]!.prompt).toContain('HEARTBEAT_OK');
    });

    it('writes run log entry to workspace/heartbeat/runs.jsonl on success', async () => {
      const dir = await createTempDir();
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs: 20, jitterMs: 0 } },
        async () => {}
      );
      await wait(50);
      stop();
      const path = join(dir, 'heartbeat', 'runs.jsonl');
      const raw = await readFile(path, 'utf8');
      const line = raw.trim().split('\n')[0];
      expect(line).toBeDefined();
      const entry = JSON.parse(line!) as {
        startedAt: string;
        finishedAt: string;
        success: boolean;
      };
      expect(entry.startedAt).toBeDefined();
      expect(entry.finishedAt).toBeDefined();
      expect(entry.success).toBe(true);
    });

    it('writes run log with success false and error when callback throws', async () => {
      const dir = await createTempDir();
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs: 20, jitterMs: 0 } },
        async () => {
          throw new Error('Simulated failure');
        }
      );
      await wait(50);
      stop();
      const path = join(dir, 'heartbeat', 'runs.jsonl');
      const raw = await readFile(path, 'utf8');
      const lines = raw
        .trim()
        .split('\n')
        .filter((l) => l.length > 0);
      const entry = JSON.parse(lines[lines.length - 1]!) as {
        success: boolean;
        error?: string;
      };
      expect(entry.success).toBe(false);
      expect(entry.error).toContain('Simulated failure');
    });

    it('uses custom options.prompt when set and still appends HEARTBEAT.md after "---"', async () => {
      const dir = await createTempDir();
      await writeFile(join(dir, 'HEARTBEAT.md'), '- Custom item', 'utf8');
      const customInstruction =
        'Custom instruction text. Reply HEARTBEAT_OK if done.';
      const calls: { prompt: string }[] = [];
      const stop = startHeartbeat(
        {
          workspace: dir,
          options: { intervalMs: 20, jitterMs: 0, prompt: customInstruction },
        },
        async (prompt) => {
          calls.push({ prompt });
        }
      );
      await wait(50);
      stop();
      expect(calls[0]!.prompt).toContain(customInstruction);
      expect(calls[0]!.prompt).toContain('---');
      expect(calls[0]!.prompt).toContain('Custom item');
    });

    it('skips run when previous run still in progress (overlap guard)', async () => {
      const dir = await createTempDir();
      const callbackDelay = 300;
      const intervalMs = 200;
      const calls: number[] = [];
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs, jitterMs: 0 } },
        async () => {
          calls.push(1);
          await wait(callbackDelay);
        }
      );
      await wait(400);
      stop();
      expect(calls.length).toBe(1);
    });

    it('does not call callback when workspace path is invalid (not a directory)', async () => {
      const dir = await createTempDir();
      const filePath = join(dir, 'not-a-dir');
      await writeFile(filePath, '', 'utf8');
      const calls: number[] = [];
      startHeartbeat(
        { workspace: filePath, options: { intervalMs: 10, jitterMs: 0 } },
        async () => {
          calls.push(1);
        }
      );
      await wait(30);
      expect(calls.length).toBe(0);
    });

    it('stop() prevents further runs', async () => {
      const dir = await createTempDir();
      const calls: number[] = [];
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs: 50, jitterMs: 0 } },
        async () => {
          calls.push(1);
        }
      );
      await wait(300);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const countAfterStop = calls.length;
      stop();
      await wait(300);
      expect(calls.length).toBe(countAfterStop);
    });

    it('respects interval before first run when jitterMs is 0 (no immediate cold start run)', async () => {
      const dir = await createTempDir();
      const calls: number[] = [];
      const stop = startHeartbeat(
        { workspace: dir, options: { intervalMs: 200, jitterMs: 0 } },
        async () => {
          calls.push(1);
        }
      );

      // With intervalMs=200 and jitterMs=0, first run should not occur before ~200ms.
      await wait(100);
      expect(calls.length).toBe(0);

      stop();
    });
  });
});
