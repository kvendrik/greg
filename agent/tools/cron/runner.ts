import { mkdirSync, watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Cron } from 'croner';
import type { AgentConfig } from '../../types';
import { getWorkspacePath } from '../../utilities';
import { appendRun } from './run-log';
import { getJobsPath, readJobs, writeJobs } from './store';
import type { CronJob } from './types';

export type ExecutePromptFn = (job: CronJob) => Promise<void>;

type CleanupFn = () => void;

export function startCronScheduler(
  config: AgentConfig,
  executePrompt: ExecutePromptFn
): Promise<() => void> {
  if (config.cron?.enabled === false) {
    return Promise.resolve(() => {});
  }

  /** Functions to stop each scheduled timer (cron, interval, or timeout). */
  const cleanups: CleanupFn[] = [];
  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  const RELOAD_DEBOUNCE_MS = 300;
  const maxConcurrent = config.cron?.maxConcurrentRuns ?? 1;
  let runningCount = 0;

  async function removeJobAndReload(jobId: string): Promise<void> {
    const jobs = await readJobs(config);
    const filtered = jobs.filter((j) => j.id !== jobId);
    await writeJobs(config, filtered);
    debouncedReload();
  }

  function scheduleRun(job: CronJob): void {
    const run = () => {
      runJob(job);
    };
    if (job.staggerMs != null && job.staggerMs > 0) {
      setTimeout(run, job.staggerMs);
    } else {
      run();
    }
  }

  /** Writes one run to the log and, for one-shot jobs with deleteAfterRun, removes the job. */
  async function recordRunResult(
    job: CronJob,
    startedAt: string,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    const finishedAt = new Date().toISOString();
    const sessionLog = join(getWorkspacePath(config), 'sessions', `job:${job.id}.jsonl`);
    try {
      await appendRun(config, {
        jobId: job.id,
        startedAt,
        finishedAt,
        success,
        error: errorMessage ?? '',
        sessionLog,
      });
    } catch (logErr) {
      console.error('[cron] Run log append failed:', logErr);
    }
    if (job.schedule.kind === 'at' && job.deleteAfterRun) {
      try {
        await removeJobAndReload(job.id);
      } catch (reloadErr) {
        console.error('[cron] removeJobAndReload failed:', reloadErr);
      }
    }
  }

  async function runJob(job: CronJob): Promise<void> {
    if (job.enabled === false) return;
    if (runningCount >= maxConcurrent) {
      console.warn(
        `[cron] Job ${job.id} skipped: max concurrent runs (${maxConcurrent}) reached.`
      );
      return;
    }
    runningCount++;
    const startedAt = new Date().toISOString();
    const retryConfig = config.cron?.retry;
    const maxAttempts = Math.max(1, retryConfig?.maxAttempts ?? 1);
    const backoffMs = retryConfig?.backoffMs ?? [];
    const retryOn = retryConfig?.retryOn ?? [];
    let succeeded = false;
    let lastErrorMessage = '';
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await executePrompt(job);
          succeeded = true;
          break;
        } catch (err) {
          lastErrorMessage = err instanceof Error ? err.message : String(err);
          const isRetriable =
            attempt < maxAttempts - 1 &&
            retryOn.length > 0 &&
            retryOn.some((pattern) => lastErrorMessage.includes(pattern));
          if (!isRetriable) break;
          const delayMs = backoffMs[attempt] ?? 1000 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      if (succeeded) {
        await recordRunResult(job, startedAt, true);
      } else {
        console.error(`[cron] Job ${job.id} failed: ${lastErrorMessage}`);
        await recordRunResult(job, startedAt, false, lastErrorMessage);
      }
    } finally {
      runningCount--;
    }
  }

  /** Stops all current schedules, reloads jobs from disk, and reschedules. */
  async function loadAndSchedule(): Promise<void> {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
    const jobs = await readJobs(config);
    const enabledJobs = jobs.filter((j) => j.enabled !== false);
    let scheduledCount = 0;
    for (const job of enabledJobs) {
      const schedule = job.schedule;
      if (schedule.kind === 'cron') {
        try {
          const cron = new Cron(
            schedule.expr,
            schedule.tz ? { timezone: schedule.tz } : undefined,
            () => {
              scheduleRun(job);
            }
          );
          cleanups.push(() => cron.stop());
          scheduledCount++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[cron] Invalid schedule for job ${job.id} (${schedule.expr}): ${message}`
          );
        }
      } else if (schedule.kind === 'every') {
        const intervalId = setInterval(
          () => scheduleRun(job),
          schedule.everyMs
        );
        cleanups.push(() => clearInterval(intervalId));
        scheduledCount++;
      } else if (schedule.kind === 'at') {
        const runAtMs = new Date(schedule.at).getTime();
        const delayMs = runAtMs - Date.now();
        if (delayMs <= 0) {
          console.warn(
            `[cron] Job ${job.id}: "at" time is in the past, skipped.`
          );
          continue;
        }
        const timeoutId = setTimeout(() => scheduleRun(job), delayMs);
        cleanups.push(() => clearTimeout(timeoutId));
        scheduledCount++;
      }
    }
    if (scheduledCount > 0) {
      console.info(`[cron] Scheduled ${scheduledCount} job(s).`);
    }
  }

  function debouncedReload(): void {
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      reloadTimeout = null;
      loadAndSchedule().catch((err) => {
        console.error('[cron] Reload failed:', err);
      });
    }, RELOAD_DEBOUNCE_MS);
  }

  return loadAndSchedule().then(() => {
    const jobsPath = getJobsPath(config);
    const jobsDir = dirname(jobsPath);
    const jobsFile = basename(jobsPath);
    let watcher: ReturnType<typeof watch> | null = null;
    try {
      mkdirSync(jobsDir, { recursive: true });
      watcher = watch(jobsDir, { persistent: false }, (event, filename) => {
        if (filename === jobsFile && event === 'change') debouncedReload();
      });
      watcher.on('error', () => {});
    } catch {
      // watch failed
    }

    return () => {
      if (reloadTimeout) clearTimeout(reloadTimeout);
      watcher?.close();
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
    };
  });
}
