import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { ToolContext } from '../../types';
import * as store from './store';
import type { CronJob } from './types';

export function getCronTools(context: ToolContext): AgentTool[] {
  const { config } = context;

  return [
    {
      name: 'cron_add',
      label: 'cron add',
      description: `Add a scheduled job. The job runs at the given cron time and sends the prompt to the agent. cronTime is 6-field: second minute hour day-of-month month day-of-week (e.g. "0 0 18 * * *" for 6pm daily). Returns the new job id.`,
      parameters: Type.Object({
        cronTime: Type.String({
          description:
            '6-field cron expression: second minute hour day-of-month month day-of-week.',
        }),
        jobPrompt: Type.String({
          description: 'Prompt text sent to the agent when the job runs.',
        }),
        name: Type.Optional(
          Type.String({ description: 'Optional short name for the job.' })
        ),
      }),
      execute: async (_id, params) => {
        const { cronTime, jobPrompt, name } = params as {
          cronTime: string;
          jobPrompt: string;
          name?: string;
        };
        const trimmedCron = cronTime.trim();
        const trimmedPrompt = jobPrompt.trim();
        if (!trimmedCron || !trimmedPrompt) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'cronTime and jobPrompt are required and cannot be empty.',
              },
            ],
            details: {},
          };
        }
        const job: CronJob = {
          id: store.generateJobId(),
          cronTime: trimmedCron,
          jobPrompt: trimmedPrompt,
          enabled: true,
        };
        if (name?.trim()) job.name = name.trim();
        const jobs = await store.readJobs(config);
        jobs.push(job);
        await store.writeJobs(config, jobs);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Added job ${job.id}. cronTime: ${job.cronTime}, jobPrompt: ${job.jobPrompt.slice(0, 80)}${job.jobPrompt.length > 80 ? '...' : ''}`,
            },
          ],
          details: { jobId: job.id, cronTime: job.cronTime, jobPrompt: job.jobPrompt },
        };
      },
    },
    {
      name: 'cron_list',
      label: 'cron list',
      description:
        'List all scheduled cron jobs. Returns id, cronTime, jobPrompt, name, and enabled for each job.',
      parameters: Type.Object({}),
      execute: async () => {
        const jobs = await store.readJobs(config);
        if (jobs.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No jobs in ${store.getJobsPath(config)}`,
              },
            ],
            details: { jobs: [] },
          };
        }
        const lines = jobs.map(
          (j) =>
            `${j.id} | ${j.cronTime} | ${j.name ?? '-'} | enabled: ${j.enabled !== false} | ${j.jobPrompt.slice(0, 60)}${j.jobPrompt.length > 60 ? '...' : ''}`
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: lines.join('\n'),
            },
          ],
          details: { jobs },
        };
      },
    },
    {
      name: 'cron_remove',
      label: 'cron remove',
      description: 'Remove a scheduled job by id. Use cron_list to see ids.',
      parameters: Type.Object({
        jobId: Type.String({ description: 'Id of the job to remove.' }),
      }),
      execute: async (_id, params) => {
        const { jobId } = params as { jobId: string };
        const jobs = await store.readJobs(config);
        const index = jobs.findIndex((j) => j.id === jobId);
        if (index === -1) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Job ${jobId} not found.`,
              },
            ],
            details: { removed: false },
          };
        }
        jobs.splice(index, 1);
        await store.writeJobs(config, jobs);
        return {
          content: [{ type: 'text' as const, text: `Removed job ${jobId}.` }],
          details: { removed: true, jobId },
        };
      },
    },
    {
      name: 'cron_update',
      label: 'cron update',
      description:
        'Update an existing job (cronTime, jobPrompt, name, or enabled). Omit fields to leave unchanged.',
      parameters: Type.Object({
        jobId: Type.String({ description: 'Id of the job to update.' }),
        cronTime: Type.Optional(Type.String()),
        jobPrompt: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        enabled: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        const { jobId, cronTime, jobPrompt, name, enabled } = params as {
          jobId: string;
          cronTime?: string;
          jobPrompt?: string;
          name?: string;
          enabled?: boolean;
        };
        const jobs = await store.readJobs(config);
        const job = jobs.find((j) => j.id === jobId);
        if (!job) {
          return {
            content: [
              { type: 'text' as const, text: `Job ${jobId} not found.` },
            ],
            details: { updated: false },
          };
        }
        if (cronTime !== undefined) {
          const trimmed = cronTime.trim();
          if (!trimmed) {
            return {
              content: [
                { type: 'text' as const, text: 'cronTime cannot be empty.' },
              ],
              details: { updated: false },
            };
          }
          job.cronTime = trimmed;
        }
        if (jobPrompt !== undefined) {
          const trimmed = jobPrompt.trim();
          if (!trimmed) {
            return {
              content: [
                { type: 'text' as const, text: 'jobPrompt cannot be empty.' },
              ],
              details: { updated: false },
            };
          }
          job.jobPrompt = trimmed;
        }
        if (name !== undefined) job.name = name.trim() || undefined;
        if (enabled !== undefined) job.enabled = enabled;
        await store.writeJobs(config, jobs);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated job ${jobId}.`,
            },
          ],
          details: { updated: true, jobId },
        };
      },
    },
    {
      name: 'cron_run',
      label: 'cron run',
      description:
        'Run a job immediately once (by id). Does not change the schedule. Use cron_list to see ids.',
      parameters: Type.Object({
        jobId: Type.String({ description: 'Id of the job to run now.' }),
      }),
      execute: async (_id, params) => {
        const { jobId } = params as { jobId: string };
        const jobs = await store.readJobs(config);
        const job = jobs.find((j) => j.id === jobId);
        if (!job) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Job ${jobId} not found.`,
              },
            ],
            details: { run: false },
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `To run job "${jobId}" now, use the CLI: greg cron run ${jobId}. The agent cannot trigger an immediate run from here; the gateway runs scheduled jobs automatically.`,
            },
          ],
          details: { run: false, jobId, hint: 'greg cron run' },
        };
      },
    },
  ];
}
