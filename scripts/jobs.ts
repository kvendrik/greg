import { completeSimple } from '@mariozechner/pi-ai';
import { CronJob } from 'cron';
import { Command } from 'commander';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import config from '../.greg';
import { getWorkspacePath } from '../service/Agent/utilities';
import { createThread, type PromptInput } from '../clients/agent-sdk';

type JobEntry = { cronTime: string; jobPrompt: string; id: string };

const JOBS_FILENAME = 'jobs.json';

function getJobsPath(): string {
  return join(getWorkspacePath(config), JOBS_FILENAME);
}

function loadJobs(): JobEntry[] {
  const path = getJobsPath();
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(raw) as JobEntry[];
  } catch {
    return [];
  }
}

function saveJobs(jobs: JobEntry[]): void {
  const dir = getWorkspacePath(config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf-8');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function extractTextFromResponse(msg: {
  content?: { type?: string; text?: string }[];
}): string {
  const content = msg.content ?? [];
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('');
}

async function runJob(job: JobEntry): Promise<void> {
  const preview =
    job.jobPrompt.length > 40
      ? job.jobPrompt.slice(0, 40) + '…'
      : job.jobPrompt;
  const label = `${job.id}: ${preview}`;
  console.log(pc.gray(`[${new Date().toISOString()}] Running job ${label}`));
  try {
    const thread = await createThread();
    const input: PromptInput = { content: job.jobPrompt, images: [] };
    await thread.prompt(input, {
      onThinking: () => {},
      onContent: (chunk) => process.stdout.write(chunk),
      onToolcall: () => {},
      onDone: () => {},
      onStop: () => {},
      onError: (err) => {
        console.error(pc.red(`Job ${job.id} error: ${err}`));
      },
    });
    await thread.destroy();
  } catch (err) {
    console.error(pc.red(`Job ${job.id} failed:`), err);
  }
}

async function parseScheduleAndJob(description: string): Promise<{
  cronTime: string;
  jobPrompt: string;
}> {
  const primary = config.models.find((m) => m.role === 'primary');
  if (primary?.role !== 'primary' || !('key' in primary)) {
    throw new Error('No primary model with API key in config.');
  }
  const model = primary.model;
  const apiKey = primary.key;

  const system = `You are a scheduler assistant. Given a natural-language description of a recurring job, output exactly two things:
1. A cron expression (6 fields: second minute hour day-of-month month day-of-week). Use "0" for seconds when not specified. Examples: "0 0 18 * * *" = every day at 6pm, "0 */30 * * * *" = every 30 minutes.
2. A short job prompt: the exact instruction to send to the primary LLM when the job runs (e.g. "Send the weather to my telegram").

Reply with a single JSON object only, no markdown or extra text: {"cronTime":"<cron>","jobPrompt":"<prompt>"}`;

  const response = await completeSimple(
    model,
    {
      systemPrompt: system,
      messages: [{ role: 'user', content: description, timestamp: Date.now() }],
    },
    { apiKey }
  );

  const text = extractTextFromResponse(response);
  const trimmed = text.replace(/^```\w*\n?|\n?```$/g, '').trim();
  const parsed = JSON.parse(trimmed) as { cronTime: string; jobPrompt: string };
  if (
    typeof parsed.cronTime !== 'string' ||
    typeof parsed.jobPrompt !== 'string'
  ) {
    throw new Error('LLM did not return valid cronTime and jobPrompt.');
  }
  return { cronTime: parsed.cronTime, jobPrompt: parsed.jobPrompt };
}

function createCronJobs(jobs: JobEntry[]): CronJob[] {
  return jobs.map((job) =>
    CronJob.from({
      cronTime: job.cronTime,
      onTick: async () => {
        await runJob(job);
      },
      start: true,
    })
  );
}

const program = new Command();

program
  .name('jobs')
  .description('Manage scheduled jobs that run prompts via the primary LLM.');

program
  .command('add')
  .description(
    'Add a job from a natural-language description (e.g. "every day at 6pm, send the weather to my telegram")'
  )
  .argument(
    '<description>',
    'Natural-language schedule and task, e.g. "every 30 minutes, remind me to stand up"'
  )
  .action(async (description: string) => {
    const jobs = loadJobs();
    const { cronTime, jobPrompt } = await parseScheduleAndJob(description);
    const entry: JobEntry = {
      id: generateId(),
      cronTime,
      jobPrompt,
    };
    jobs.push(entry);
    saveJobs(jobs);
    console.log('Added job:');
    console.log('  cronTime:', cronTime);
    console.log('  jobPrompt:', jobPrompt);
    console.log('  id:', entry.id);
  });

program
  .command('list')
  .description('List all scheduled jobs.')
  .action(() => {
    const jobs = loadJobs();
    if (jobs.length === 0) {
      console.log('No jobs in', getJobsPath());
      return;
    }
    for (const job of jobs) {
      console.log(pc.cyan(job.id));
      console.log('  cronTime:', job.cronTime);
      console.log('  jobPrompt:', job.jobPrompt);
    }
  });

program
  .command('remove')
  .description('Remove a job by id.')
  .argument('<id>', 'Job id (from list or add output)')
  .action((id: string) => {
    const jobs = loadJobs();
    const index = jobs.findIndex((job) => job.id === id);
    if (index === -1) {
      console.error(pc.red(`No job with id "${id}".`));
      process.exit(1);
    }
    jobs.splice(index, 1);
    saveJobs(jobs);
    console.log('Removed job', id);
  });

program
  .command('run')
  .description('Run a job by id immediately (without scheduling).')
  .argument('<id>', 'Job id (from list or add output)')
  .action(async (id: string) => {
    const jobs = loadJobs();
    const job = jobs.find((entry) => entry.id === id);
    if (!job) {
      console.error(pc.red(`No job with id "${id}".`));
      process.exit(1);
    }
    await runJob(job);
  });

program
  .command('schedule')
  .description(
    'Read jobs.json and run the cron scheduler (agent server must be running).'
  )
  .action(async () => {
    let cronJobs: CronJob[] = [];

    async function reload() {
      for (const cronJob of cronJobs) {
        await cronJob.stop();
      }
      cronJobs = [];
      const jobs = loadJobs();
      if (jobs.length > 0) {
        cronJobs = createCronJobs(jobs);
        console.log(pc.gray(`Loaded ${jobs.length} job(s).`));
        return;
      }
      console.log(pc.gray(`Loaded 0 jobs.`));
    }

    await reload();
    if (cronJobs.length === 0) {
      console.log('No jobs in', getJobsPath());
    }

    const workspaceDir = getWorkspacePath(config);
    if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
    let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
    watch(workspaceDir, (_eventType, filename) => {
      if (filename !== JOBS_FILENAME) return;
      if (reloadTimeout) clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(async () => {
        reloadTimeout = null;
        await reload();
      }, 300);
    });
    console.log('Watching jobs.json for changes. Ctrl+C to stop.');
  });

program.parse();
