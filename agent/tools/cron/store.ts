import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentConfig } from '../../types';
import { getWorkspacePath } from '../../utilities/impl';
import type { CronJob, CronJobsFile } from './types';

const JOBS_FILENAME = 'cron/jobs.json';

export function getJobsPath(config: AgentConfig): string {
  return `${getWorkspacePath(config)}/${JOBS_FILENAME}`;
}

export async function readJobs(config: AgentConfig): Promise<CronJob[]> {
  const path = getJobsPath(config);
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as CronJobsFile;
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

export async function writeJobs(
  config: AgentConfig,
  jobs: CronJob[]
): Promise<void> {
  const path = getJobsPath(config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ jobs }, null, 2),
    'utf8'
  );
}

export function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
