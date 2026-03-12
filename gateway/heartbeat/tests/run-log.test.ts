import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  appendHeartbeatRun,
  pruneHeartbeatRuns,
} from '../run-log';

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'heartbeat-runlog-test-'));
}

describe('heartbeat', () => {
  describe('run-log', () => {
    it('writes run to workspace/heartbeat/runs.jsonl with startedAt, finishedAt, success, error', async () => {
      const dir = await createTempDir();
      const entry = {
        startedAt: '2025-01-15T10:00:00.000Z',
        finishedAt: '2025-01-15T10:00:05.000Z',
        success: true,
      };
      await appendHeartbeatRun(dir, entry);
      const path = join(dir, 'heartbeat', 'runs.jsonl');
      const raw = await readFile(path, 'utf8');
      const line = raw.trim().split('\n')[0];
      const parsed = JSON.parse(line!) as typeof entry;
      expect(parsed.startedAt).toBe(entry.startedAt);
      expect(parsed.finishedAt).toBe(entry.finishedAt);
      expect(parsed.success).toBe(true);
    });

    it('appends failure entry with error message', async () => {
      const dir = await createTempDir();
      await appendHeartbeatRun(dir, {
        startedAt: '2025-01-15T10:00:00.000Z',
        finishedAt: '2025-01-15T10:00:01.000Z',
        success: false,
        error: 'Connection refused',
      });
      const path = join(dir, 'heartbeat', 'runs.jsonl');
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw.trim()) as { success: boolean; error?: string };
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Connection refused');
    });

    it('prunes when over runLog.maxBytes, keeping last keepLines lines', async () => {
      const dir = await createTempDir();
      const longLine = JSON.stringify({
        startedAt: '2025-01-15T10:00:00.000Z',
        finishedAt: '2025-01-15T10:00:00.000Z',
        success: true,
        padding: 'x'.repeat(500),
      }) + '\n';
      const path = join(dir, 'heartbeat', 'runs.jsonl');
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(join(dir, 'heartbeat'), { recursive: true });
      const lines = 20;
      await writeFile(path, longLine.repeat(lines), 'utf8');
      await pruneHeartbeatRuns(dir, { maxBytes: 1000, keepLines: 5 });
      const raw = await readFile(path, 'utf8');
      const kept = raw.trim().split('\n').filter((l) => l.length > 0);
      expect(kept.length).toBe(5);
    });
  });
});
