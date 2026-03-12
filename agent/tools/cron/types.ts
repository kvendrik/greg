export interface CronJob {
  id: string;
  /** 6-field cron: second minute hour day-of-month month day-of-week */
  cronTime: string;
  /** Prompt sent to the agent when the job runs */
  jobPrompt: string;
  name?: string;
  enabled?: boolean;
}

export interface CronJobsFile {
  jobs: CronJob[];
}
