import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { ToolContext } from '../../types';
import * as store from './store';
import { formatSchedule } from './format';
import type { CronJob, Schedule } from './types';
import { validateSchedule } from './validate';

const ScheduleSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('cron'),
    expr: Type.String({ description: '6-field cron expression.' }),
    tz: Type.Optional(
      Type.String({ description: 'IANA timezone (e.g. Europe/Amsterdam).' })
    ),
  }),
  Type.Object({
    kind: Type.Literal('every'),
    everyMs: Type.Number({ description: 'Interval in milliseconds.' }),
  }),
  Type.Object({
    kind: Type.Literal('at'),
    at: Type.String({
      description: 'ISO 8601 or date string for one-shot run.',
    }),
  }),
]);

export function getCronTools(context: ToolContext): AgentTool[] {
  const { config } = context;

  return [
    {
      name: 'cron_add',
      label: 'cron add',
      description: `Add a scheduled job. Schedule: kind "cron" (expr + optional tz), "every" (everyMs), or "at" (one-shot ISO date). Returns the new job id.`,
      parameters: Type.Object({
        schedule: ScheduleSchema,
        jobPrompt: Type.String({
          description: 'Prompt text sent to the agent when the job runs.',
        }),
        name: Type.Optional(
          Type.String({ description: 'Optional short name for the job.' })
        ),
        staggerMs: Type.Optional(
          Type.Number({
            description: 'Delay execution by this many ms to spread load.',
          })
        ),
        deleteAfterRun: Type.Optional(
          Type.Boolean({
            description:
              'If true and schedule is "at", remove the job after it runs once.',
          })
        ),
      }),
      execute: async (_id, params) => {
        const { schedule, jobPrompt, name, staggerMs, deleteAfterRun } =
          params as {
            schedule: Schedule;
            jobPrompt: string;
            name?: string;
            staggerMs?: number;
            deleteAfterRun?: boolean;
          };
        const trimmedPrompt = jobPrompt.trim();
        if (!trimmedPrompt) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'jobPrompt is required and cannot be empty.',
              },
            ],
            details: {},
          };
        }
        const validation = validateSchedule(schedule);
        if (!validation.valid) {
          return {
            content: [
              {
                type: 'text' as const,
                text: validation.error ?? 'Invalid schedule.',
              },
            ],
            details: { valid: false, error: validation.error },
          };
        }
        const job: CronJob = {
          id: store.generateJobId(),
          schedule,
          jobPrompt: trimmedPrompt,
          enabled: true,
        };
        if (name?.trim()) job.name = name.trim();
        if (staggerMs != null && staggerMs >= 0) job.staggerMs = staggerMs;
        if (deleteAfterRun === true) job.deleteAfterRun = true;
        const jobs = await store.readJobs(config);
        jobs.push(job);
        await store.writeJobs(config, jobs);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Added job ${job.id}. ${formatSchedule(schedule)}, jobPrompt: ${job.jobPrompt.slice(0, 80)}${job.jobPrompt.length > 80 ? '...' : ''}`,
            },
          ],
          details: {
            jobId: job.id,
            schedule: job.schedule,
            jobPrompt: job.jobPrompt,
          },
        };
      },
    },
    {
      name: 'cron_list',
      label: 'cron list',
      description:
        'List all scheduled cron jobs. Returns id, schedule, jobPrompt, name, and enabled for each job.',
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
            `${j.id} | ${formatSchedule(j.schedule)} | ${j.name ?? '-'} | enabled: ${j.enabled !== false} | ${j.jobPrompt.slice(0, 60)}${j.jobPrompt.length > 60 ? '...' : ''}`
        );
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
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
              { type: 'text' as const, text: `Job ${jobId} not found.` },
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
        'Update an existing job (schedule, jobPrompt, name, or enabled). Omit fields to leave unchanged.',
      parameters: Type.Object({
        jobId: Type.String({ description: 'Id of the job to update.' }),
        schedule: Type.Optional(ScheduleSchema),
        jobPrompt: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        enabled: Type.Optional(Type.Boolean()),
        staggerMs: Type.Optional(Type.Number()),
        deleteAfterRun: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        const {
          jobId,
          schedule,
          jobPrompt,
          name,
          enabled,
          staggerMs,
          deleteAfterRun,
        } = params as {
          jobId: string;
          schedule?: Schedule;
          jobPrompt?: string;
          name?: string;
          enabled?: boolean;
          staggerMs?: number;
          deleteAfterRun?: boolean;
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
        if (schedule !== undefined) {
          const validation = validateSchedule(schedule);
          if (!validation.valid) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: validation.error ?? 'Invalid schedule.',
                },
              ],
              details: { updated: false },
            };
          }
          job.schedule = schedule;
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
        if (staggerMs !== undefined)
          job.staggerMs = staggerMs >= 0 ? staggerMs : undefined;
        if (deleteAfterRun !== undefined) job.deleteAfterRun = deleteAfterRun;
        await store.writeJobs(config, jobs);
        return {
          content: [{ type: 'text' as const, text: `Updated job ${jobId}.` }],
          details: { updated: true, jobId },
        };
      },
    },
    {
      name: 'cron_run_hint',
      label: 'cron run hint',
      description:
        'Returns instructions for running a job immediately. Does not execute the job—the agent cannot trigger an immediate run; the user must run `greg cron run <jobId>` in the terminal (gateway must be running). Use when the user asks to run a job now. Use cron_list to see job ids.',
      parameters: Type.Object({
        jobId: Type.String({
          description: 'Id of the job to run (user runs via CLI).',
        }),
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
