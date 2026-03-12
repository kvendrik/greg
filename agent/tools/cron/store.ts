import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentConfig } from '../../types';
import { getWorkspacePath } from '../../utilities/impl';
import type { CronJob, CronJobsFile, LegacyCronJob, Schedule } from './types';

const JOBS_FILENAME = 'cron/jobs.json';

function resolvePath(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export function getJobsPath(config: AgentConfig): string {
  if (config.cron?.store) {
    return resolvePath(config.cron.store);
  }
  return `${getWorkspacePath(config)}/${JOBS_FILENAME}`;
}

/** Converts legacy jobs (cronTime) to the current shape (schedule). */
function normalizeJob(raw: CronJob | LegacyCronJob): CronJob {
  if ('cronTime' in raw && typeof (raw as LegacyCronJob).cronTime === 'string') {
    const legacy = raw as LegacyCronJob;
    return {
      id: legacy.id,
      schedule: { kind: 'cron', expr: legacy.cronTime },
      jobPrompt: legacy.jobPrompt,
      name: legacy.name,
      enabled: legacy.enabled,
    };
  }
  return raw as CronJob;
}

export async function readJobs(config: AgentConfig): Promise<CronJob[]> {
  const path = getJobsPath(config);
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as { jobs?: (CronJob | LegacyCronJob)[] };
    const list = Array.isArray(data.jobs) ? data.jobs : [];
    return list.map(normalizeJob);
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
