/** Recurring: cron expression, optional IANA timezone. */
export interface CronSchedule {
  kind: 'cron';
  expr: string;
  tz?: string;
}

/** Recurring: fixed interval in milliseconds. */
export interface EverySchedule {
  kind: 'every';
  everyMs: number;
}

/** One-shot: run at a specific time (ISO 8601). */
export interface AtSchedule {
  kind: 'at';
  at: string;
}

export type Schedule = CronSchedule | EverySchedule | AtSchedule;

export interface CronJob {
  id: string;
  schedule: Schedule;
  /** Prompt sent to the agent when the job runs */
  jobPrompt: string;
  name?: string;
  enabled?: boolean;
  /** Delay execution by this many ms (e.g. to spread load). */
  staggerMs?: number;
  /** If true and schedule is "at", remove the job after it runs once. */
  deleteAfterRun?: boolean;
}

export interface CronJobsFile {
  jobs: CronJob[];
}

/** Legacy job shape (pre-T1): has cronTime instead of schedule. */
export interface LegacyCronJob {
  id: string;
  cronTime: string;
  jobPrompt: string;
  name?: string;
  enabled?: boolean;
}
