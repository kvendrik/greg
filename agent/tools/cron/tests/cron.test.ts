import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { AgentConfig } from '../../../types';
import {
  appendRun,
  getRunsPathForRead,
  pruneRuns,
  readRuns,
  type RunLogEntry,
} from '../run-log';
import { startCronScheduler } from '../runner';
import { generateJobId, getJobsPath, readJobs, writeJobs } from '../store';
import { formatSchedule } from '../format';
import type { CronJob } from '../types';
import {
  validateAtSchedule,
  validateCronSchedule,
  validateEverySchedule,
  validateSchedule,
  validateTimezone,
} from '../validate';
import { getCronTools } from '../cron-tools';

function createMockConfig(
  workspace: string,
  overrides?: Partial<AgentConfig>
): AgentConfig {
  return {
    id: 'test',
    workspace,
    port: '0',
    models: [],
    tools: {},
    ...overrides,
  } as AgentConfig;
}

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cron-test-'));
}

describe('cron', () => {
  describe('getJobsPath()', () => {
    it('returns workspace/cron/jobs.json by default', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const path = getJobsPath(config);
      expect(path).toBe(join(dir, 'cron', 'jobs.json'));
    });

    it('returns cron.store when set', async () => {
      const dir = await createTempDir();
      const customPath = join(dir, 'custom', 'jobs.json');
      const config = createMockConfig(dir, { cron: { store: customPath } });
      expect(getJobsPath(config)).toBe(customPath);
    });
  });

  describe('readJobs()', () => {
    it('returns [] when file is missing', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const jobs = await readJobs(config);
      expect(jobs).toEqual([]);
    });

    it('normalizes legacy cronTime to schedule', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []); // ensure cron dir exists
      await writeFile(
        getJobsPath(config),
        JSON.stringify({
          jobs: [
            {
              id: 'legacy-1',
              cronTime: '0 0 18 * * *',
              jobPrompt: 'Legacy job',
            },
          ],
        }),
        'utf8'
      );
      const jobs = await readJobs(config);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].schedule).toEqual({ kind: 'cron', expr: '0 0 18 * * *' });
      expect(jobs[0].jobPrompt).toBe('Legacy job');
    });
  });

  describe('writeJobs()', () => {
    it('round-trips jobs with schedule, prompt, name, stagger, deleteAfterRun', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const jobs: CronJob[] = [
        {
          id: 'job-1',
          schedule: { kind: 'cron', expr: '0 0 18 * * *' },
          jobPrompt: 'Daily summary',
          name: 'Evening brief',
          enabled: true,
          staggerMs: 100,
        },
        {
          id: 'job-2',
          schedule: { kind: 'every', everyMs: 60000 },
          jobPrompt: 'Every minute',
          enabled: false,
        },
        {
          id: 'job-3',
          schedule: { kind: 'at', at: '2025-12-31T23:59:00.000Z' },
          jobPrompt: 'One-shot',
          deleteAfterRun: true,
        },
      ];
      await writeJobs(config, jobs);
      const read = await readJobs(config);
      expect(read).toHaveLength(3);
      expect(read[0].schedule).toEqual({ kind: 'cron', expr: '0 0 18 * * *' });
      expect(read[0].jobPrompt).toBe('Daily summary');
      expect(read[0].name).toBe('Evening brief');
      expect(read[0].staggerMs).toBe(100);
      expect(read[1].schedule).toEqual({ kind: 'every', everyMs: 60000 });
      expect(read[2].schedule.kind).toBe('at');
      expect((read[2].schedule as { at: string }).at).toBe(
        '2025-12-31T23:59:00.000Z'
      );
      expect(read[2].deleteAfterRun).toBe(true);
    });
  });

  describe('generateJobId()', () => {
    it('returns string starting with job-', () => {
      const id = generateJobId();
      expect(id.startsWith('job-')).toBe(true);
      expect(typeof id).toBe('string');
    });
  });

  describe('getRunsPathForRead()', () => {
    it('returns cron/runs/runs.jsonl next to jobs file', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const runsPath = getRunsPathForRead(config);
      expect(runsPath).toBe(join(dir, 'cron', 'runs', 'runs.jsonl'));
    });

    it('returns dirname of cron.store plus runs/runs.jsonl when store set', async () => {
      const dir = await createTempDir();
      const customStore = join(dir, 'custom', 'jobs.json');
      const config = createMockConfig(dir, { cron: { store: customStore } });
      const runsPath = getRunsPathForRead(config);
      expect(runsPath).toBe(join(dir, 'custom', 'runs', 'runs.jsonl'));
    });
  });

  describe('appendRun()', () => {
    it('writes one JSONL line per run with jobId, startedAt, finishedAt, success, error', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []); // ensure cron dir exists
      const entry: RunLogEntry = {
        jobId: 'job-1',
        startedAt: '2025-01-01T10:00:00.000Z',
        finishedAt: '2025-01-01T10:00:05.000Z',
        success: true,
        error: '',
        sessionLog: '',
      };
      await appendRun(config, entry);
      const raw = await readFile(getRunsPathForRead(config), 'utf8');
      const line = raw.trim().split('\n')[0];
      const parsed = JSON.parse(line!) as RunLogEntry;
      expect(parsed.jobId).toBe('job-1');
      expect(parsed.startedAt).toBe(entry.startedAt);
      expect(parsed.finishedAt).toBe(entry.finishedAt);
      expect(parsed.success).toBe(true);
    });

    it('persists error field when success is false', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      await appendRun(config, {
        jobId: 'job-2',
        startedAt: '2025-01-01T10:00:00.000Z',
        finishedAt: '2025-01-01T10:00:01.000Z',
        success: false,
        error: 'Something failed',
        sessionLog: '',
      });
      const raw = await readFile(getRunsPathForRead(config), 'utf8');
      const parsed = JSON.parse(raw.trim()) as RunLogEntry;
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Something failed');
    });
  });

  describe('pruneRuns()', () => {
    it('keeps last keepLines when file exceeds maxBytes', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir, {
        cron: { runLog: { maxBytes: 100, keepLines: 2 } },
      });
      await writeJobs(config, []);
      for (let i = 0; i < 5; i++) {
        await appendRun(config, {
          jobId: `job-${i}`,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          success: true,
          error: '',
          sessionLog: '',
        });
      }
      const raw = await readFile(getRunsPathForRead(config), 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(2);
    });
  });

  describe('readRuns()', () => {
    it('returns [] when file is missing', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const empty = await readRuns(config, 50);
      expect(empty).toEqual([]);
    });

    it('returns last N entries oldest-first in slice', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      await appendRun(config, {
        jobId: 'a',
        startedAt: '2025-01-01T10:00:00.000Z',
        finishedAt: '2025-01-01T10:00:01.000Z',
        success: true,
        error: '',
        sessionLog: '',
      });
      await appendRun(config, {
        jobId: 'b',
        startedAt: '2025-01-01T10:01:00.000Z',
        finishedAt: '2025-01-01T10:01:01.000Z',
        success: true,
        error: '',
        sessionLog: '',
      });
      const two = await readRuns(config, 10);
      expect(two).toHaveLength(2);
      expect(two[0]!.jobId).toBe('a');
      expect(two[1]!.jobId).toBe('b');
    });

    it('respects limit parameter', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      for (let i = 0; i < 5; i++) {
        await appendRun(config, {
          jobId: `job-${i}`,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          success: true,
          error: '',
          sessionLog: '',
        });
      }
      const limited = await readRuns(config, 2);
      expect(limited).toHaveLength(2);
    });

    it('returns persisted entries (defaults 2MB maxBytes, 2000 keepLines per README)', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      await appendRun(config, {
        jobId: 'x',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        success: true,
        error: '',
        sessionLog: '',
      });
      const path = getRunsPathForRead(config);
      const raw = await readFile(path, 'utf8');
      expect(raw).toContain('"jobId":"x"');
      const entries = await readRuns(config, 10);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.jobId).toBe('x');
    });
  });

  describe('validateCronSchedule()', () => {
    it('accepts valid 6-field expr', () => {
      expect(validateCronSchedule('0 0 18 * * *').valid).toBe(true);
    });
    it('rejects invalid expr', () => {
      const r = validateCronSchedule('invalid');
      expect(r.valid).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('validateEverySchedule()', () => {
    it('accepts positive number', () => {
      expect(validateEverySchedule(60000).valid).toBe(true);
    });
    it('rejects non-positive', () => {
      expect(validateEverySchedule(0).valid).toBe(false);
      expect(validateEverySchedule(-1).valid).toBe(false);
    });
  });

  describe('validateAtSchedule()', () => {
    it('accepts future ISO date', () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      expect(validateAtSchedule(future).valid).toBe(true);
    });
    it('rejects past date', () => {
      const r = validateAtSchedule('2020-01-01T00:00:00.000Z');
      expect(r.valid).toBe(false);
      expect(r.error).toContain('past');
    });
    it('rejects invalid date string', () => {
      const r = validateAtSchedule('not-a-date');
      expect(r.valid).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('validateTimezone()', () => {
    it('accepts valid IANA timezone', () => {
      expect(validateTimezone('Europe/Amsterdam').valid).toBe(true);
    });
    it('rejects invalid timezone', () => {
      const r = validateTimezone('Not/Real');
      expect(r.valid).toBe(false);
    });
  });

  describe('validateSchedule()', () => {
    it('dispatches by kind and validates cron, every, at', () => {
      expect(
        validateSchedule({ kind: 'cron', expr: '0 0 18 * * *' }).valid
      ).toBe(true);
      expect(validateSchedule({ kind: 'every', everyMs: 1000 }).valid).toBe(
        true
      );
      const future = new Date(Date.now() + 86400000).toISOString();
      expect(validateSchedule({ kind: 'at', at: future }).valid).toBe(true);
    });
  });

  describe('formatSchedule()', () => {
    it('returns human-readable string for cron with and without tz', () => {
      expect(formatSchedule({ kind: 'cron', expr: '0 0 18 * * *' })).toContain(
        'cron'
      );
      expect(
        formatSchedule({
          kind: 'cron',
          expr: '0 0 18 * * *',
          tz: 'Europe/Amsterdam',
        })
      ).toContain('Europe/Amsterdam');
    });
    it('returns human-readable for every and at', () => {
      expect(formatSchedule({ kind: 'every', everyMs: 60000 })).toContain(
        '60000'
      );
      expect(
        formatSchedule({ kind: 'at', at: '2025-12-31T23:59:00.000Z' })
      ).toContain('2025');
    });
  });

  describe('getCronTools()', () => {
    it('returns cron_add, cron_list, cron_remove, cron_update, cron_run_hint', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const tools = getCronTools({ config });
      const names = tools.map((t) => t.name);
      expect(names).toContain('cron_add');
      expect(names).toContain('cron_list');
      expect(names).toContain('cron_remove');
      expect(names).toContain('cron_update');
      expect(names).toContain('cron_run_hint');
    });

    it('cron_add rejects empty jobPrompt', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const tools = getCronTools({ config });
      const add = tools.find((t) => t.name === 'cron_add')!;
      const result = await add.execute!('', {
        schedule: { kind: 'every', everyMs: 60000 },
        jobPrompt: '   ',
      });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain('jobPrompt');
      expect(text).toContain('empty');
      const jobs = await readJobs(config);
      expect(jobs).toHaveLength(0);
    });

    it('cron_add rejects invalid schedule', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const tools = getCronTools({ config });
      const add = tools.find((t) => t.name === 'cron_add')!;
      const result = await add.execute!('', {
        schedule: { kind: 'cron', expr: 'invalid-cron' },
        jobPrompt: 'Valid prompt',
      });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toMatch(/invalid|error/i);
      const jobs = await readJobs(config);
      expect(jobs).toHaveLength(0);
    });

    it('cron_add adds job and returns job id', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const tools = getCronTools({ config });
      const add = tools.find((t) => t.name === 'cron_add')!;
      const result = await add.execute!('', {
        schedule: { kind: 'every', everyMs: 60000 },
        jobPrompt: 'Test prompt',
      });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain('Added job');
      expect(text).toMatch(/job-\d+-/);
      const jobs = await readJobs(config);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.jobPrompt).toBe('Test prompt');
    });

    it('cron_list returns message when no jobs and lists id schedule name enabled when jobs exist', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      const tools = getCronTools({ config });
      const list = tools.find((t) => t.name === 'cron_list')!;
      const emptyResult = await list.execute!('', {});
      const emptyText = (emptyResult!.content[0] as { text: string }).text;
      expect(emptyText).toContain('No jobs');

      await writeJobs(config, [
        {
          id: 'j1',
          schedule: { kind: 'cron', expr: '0 0 18 * * *' },
          jobPrompt: 'Evening',
          name: 'Brief',
          enabled: true,
        },
      ]);
      const listResult = await list.execute!('', {});
      const listText = (listResult!.content[0] as { text: string }).text;
      expect(listText).toContain('j1');
      expect(listText).toContain('Brief');
      expect(listText).toContain('enabled');
    });

    it('cron_remove removes job by id', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, [
        {
          id: 'to-remove',
          schedule: { kind: 'every', everyMs: 1000 },
          jobPrompt: 'X',
          enabled: true,
        },
      ]);
      const tools = getCronTools({ config });
      const remove = tools.find((t) => t.name === 'cron_remove')!;
      await remove.execute!('', { jobId: 'to-remove' });
      const jobs = await readJobs(config);
      expect(jobs).toHaveLength(0);
    });

    it('cron_remove returns not found when job id does not exist', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      const tools = getCronTools({ config });
      const remove = tools.find((t) => t.name === 'cron_remove')!;
      const result = await remove.execute!('', { jobId: 'nonexistent' });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain('not found');
      const details = result!.details as { removed?: boolean };
      expect(details.removed).toBe(false);
    });

    it('cron_update returns not found when job id does not exist', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      const tools = getCronTools({ config });
      const update = tools.find((t) => t.name === 'cron_update')!;
      const result = await update.execute!('', {
        jobId: 'nonexistent',
        jobPrompt: 'New',
      });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain('not found');
      expect((result!.details as { updated?: boolean }).updated).toBe(false);
    });

    it('cron_update updates schedule, jobPrompt, name, enabled', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, [
        {
          id: 'up',
          schedule: { kind: 'every', everyMs: 1000 },
          jobPrompt: 'Old',
          name: 'OldName',
          enabled: true,
        },
      ]);
      const tools = getCronTools({ config });
      const update = tools.find((t) => t.name === 'cron_update')!;
      await update.execute!('', {
        jobId: 'up',
        jobPrompt: 'New prompt',
        name: 'NewName',
        enabled: false,
      });
      const jobs = await readJobs(config);
      expect(jobs[0]!.jobPrompt).toBe('New prompt');
      expect(jobs[0]!.name).toBe('NewName');
      expect(jobs[0]!.enabled).toBe(false);
    });

    it('cron_run_hint returns hint to use CLI when job exists', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, [
        {
          id: 'run-me',
          schedule: { kind: 'every', everyMs: 1000 },
          jobPrompt: 'X',
          enabled: true,
        },
      ]);
      const tools = getCronTools({ config });
      const run = tools.find((t) => t.name === 'cron_run_hint')!;
      const result = await run.execute!('', { jobId: 'run-me' });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain('greg cron run');
    });

    it('cron_run_hint returns not found when job id does not exist', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, []);
      const tools = getCronTools({ config });
      const run = tools.find((t) => t.name === 'cron_run_hint')!;
      const result = await run.execute!('', { jobId: 'nonexistent' });
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain('not found');
    });
  });

  describe('startCronScheduler()', () => {
    it('returns no-op stop when cron.enabled is false', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir, { cron: { enabled: false } });
      const stop = await startCronScheduler(config, async () => {});
      stop();
      expect(typeof stop).toBe('function');
    });

    it('loads jobs, runs callback on tick, and appends run to log', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, [
        {
          id: 'every-job',
          schedule: { kind: 'every', everyMs: 20 },
          jobPrompt: 'Quick run',
          enabled: true,
        },
      ]);
      const receivedJobs: CronJob[] = [];
      const stop = await startCronScheduler(config, async (job: CronJob) => {
        receivedJobs.push(job);
      });
      await new Promise((r) => setTimeout(r, 50));
      stop();
      expect(receivedJobs.length).toBeGreaterThanOrEqual(1);
      expect(receivedJobs[0]!.jobPrompt).toBe('Quick run');
      expect(receivedJobs[0]!.id).toBe('every-job');
      const runs = await readRuns(config, 10);
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs.some((r) => r.jobId === 'every-job')).toBe(true);
    });

    it('does not run jobs with enabled false', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, [
        {
          id: 'enabled-job',
          schedule: { kind: 'every', everyMs: 25 },
          jobPrompt: 'Run me',
          enabled: true,
        },
        {
          id: 'disabled-job',
          schedule: { kind: 'every', everyMs: 25 },
          jobPrompt: 'Skip me',
          enabled: false,
        },
      ]);
      const receivedJobs: CronJob[] = [];
      const stop = await startCronScheduler(config, async (job: CronJob) => {
        receivedJobs.push(job);
      });
      await new Promise((r) => setTimeout(r, 60));
      stop();
      expect(receivedJobs.every((j) => j.id === 'enabled-job')).toBe(true);
      expect(receivedJobs.some((j) => j.id === 'disabled-job')).toBe(false);
    });

    it('appends run with success false and error when callback throws', async () => {
      const dir = await createTempDir();
      const config = createMockConfig(dir);
      await writeJobs(config, [
        {
          id: 'fail-job',
          schedule: { kind: 'every', everyMs: 20 },
          jobPrompt: 'Fail',
          enabled: true,
        },
      ]);
      const stop = await startCronScheduler(config, async () => {
        throw new Error('Callback failed');
      });
      await new Promise((r) => setTimeout(r, 50));
      stop();
      const runs = await readRuns(config, 10);
      const failed = runs.find((r) => r.jobId === 'fail-job');
      expect(failed).toBeDefined();
      expect(failed!.success).toBe(false);
      expect(failed!.error).toContain('Callback failed');
    });
  });
});
