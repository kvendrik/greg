import { Cron } from 'croner';
import type { AgentConfig } from '../../types';
import { readJobs } from './store';
import type { CronJob } from './types';

export type ExecutePromptFn = (jobPrompt: string) => Promise<void>;

export function startCronScheduler(
  config: AgentConfig,
  executePrompt: ExecutePromptFn
): Promise<() => void> {
  const jobs: InstanceType<typeof Cron>[] = [];

  async function runJob(job: CronJob): Promise<void> {
    if (job.enabled === false) return;
    try {
      await executePrompt(job.jobPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron] Job ${job.id} failed: ${message}`);
    }
  }

  async function loadAndSchedule(): Promise<void> {
    for (const j of jobs) {
      j.stop();
    }
    jobs.length = 0;
    const list = await readJobs(config);
    const enabled = list.filter((j) => j.enabled !== false);
    for (const job of enabled) {
      try {
        const cron = new Cron(job.cronTime, async () => {
          await runJob(job);
        });
        jobs.push(cron);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[cron] Invalid schedule for job ${job.id} (${job.cronTime}): ${message}`
        );
      }
    }
    if (enabled.length > 0) {
      console.info(`[cron] Scheduled ${jobs.length} job(s).`);
    }
  }

  return loadAndSchedule().then(() => () => {
    for (const j of jobs) {
      j.stop();
    }
    jobs.length = 0;
  });
}
