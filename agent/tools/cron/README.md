# Cron

Scheduled jobs that send prompts to the agent (e.g. “every day at 6pm run this prompt”). Used for briefings, reminders, and recurring tasks.

## What it does

- **Jobs** are stored in the workspace as `cron/jobs.json`. Each job has a schedule (cron expression, interval, or one-shot time), a prompt, and optional name/stagger/delete-after-run.
- **Runner** (started by the gateway) loads jobs, schedules them with croner/intervals/timeouts, and on each tick runs the prompt via a callback you provide. It also appends each run to a JSONL log and supports hot-reload when the jobs file changes.
- **Runs** are stored in a single file `cron/runs/runs.jsonl` (next to the jobs file). Each line is one run: `{ jobId, startedAt, finishedAt?, success?, error? }`. The file is pruned when it exceeds `cron.runLog.maxBytes` (default 2MB), keeping the last `cron.runLog.keepLines` (default 2000) lines. View with `greg cron runs`. We use one file (rather than one file per run) so we can prune by reading the file, keeping the last N lines, and rewriting—no listing or deleting many files—and so “last N runs” is a simple tail read.
- **Tools** (`cron_add`, `cron_list`, `cron_remove`, `cron_update`, `cron_run`) let the agent manage jobs from chat.
- **CLI** (`greg cron add/list/update/remove/run/runs`) lets you manage jobs and view run history from the terminal.

## Why

So users and the agent can set up “run this prompt at 6pm daily” or “in 20 minutes” without writing custom scripts. The gateway keeps one scheduler; jobs are just data in the workspace.

## How to use

**From the gateway:** Start the scheduler and pass a function that runs a prompt (e.g. loads the `cron` session and calls `prompt`):

```ts
import { startCronScheduler } from '../agent/tools/cron';

const stopCron = await startCronScheduler(config, async (jobPrompt: string) => {
  const session = await sessions.load('cron');
  await session.prompt({ content: jobPrompt, images: [] });
});
// On shutdown: stopCron();
```

**From the CLI:** Add, list, update, remove, run, or show recent runs:

```bash
greg cron add --cron "0 0 18 * * *" --prompt "Daily summary"
greg cron add --every 60000 --prompt "Every minute"
greg cron list
greg cron runs --limit 20
greg cron run <jobId>
```

**From the agent:** Use the cron tools (e.g. `cron_add` with a `schedule` and `jobPrompt`). The skill `jobs-cli` documents them.

**Config (optional):** In `.greg` you can set `cron.enabled`, `cron.store`, `cron.maxConcurrentRuns`, `cron.retry` (e.g. `maxAttempts`, `backoffMs`, `retryOn`), and `cron.runLog` (e.g. `maxBytes`, `keepLines`).

## Files in this folder

- `types.ts` — Job and schedule shapes.
- `store.ts` — Read/write `jobs.json`; normalizes legacy `cronTime` to `schedule`.
- `run-log.ts` — Append and prune run log; `readRuns` for history.
- `validate.ts` — Validate cron/at/every and timezone.
- `format.ts` — Human-readable schedule string.
- `cron-tools.ts` — Agent tools (add/list/remove/update/run).
- `runner.ts` — Scheduler: load jobs, schedule with croner/setInterval/setTimeout, run callback, optional retry and run log.
