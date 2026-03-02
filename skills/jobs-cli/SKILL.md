---
name: jobs-cli
description: Manage scheduled LLM jobs via Greg’s jobs CLI. Use when the user wants recurring tasks or automations that run prompts on a schedule (add, list, remove, and run cron-based jobs stored in jobs.json).
---

# Jobs CLI (scheduled prompts)

Manage recurring, cron-based jobs that send prompts to Greg’s primary LLM. Jobs are stored in `jobs.json` in Greg’s workspace directory and executed via the agent server.

## How to run

From the repo root, always use `bun` and the `scripts/jobs` entry point:

```bash
# Show help and available subcommands
bun run scripts/jobs --help
```

Subcommands are passed after `scripts/jobs`, for example:

```bash
bun run scripts/jobs add "every day at 6pm, send me a summary of my calendar"
bun run scripts/jobs list
bun run scripts/jobs remove <id>
bun run scripts/jobs schedule
```

## Requirements

- **Primary model configured** in `.greg` with a `role: "primary"` entry that includes:
  - a valid `model` string
  - an API key field (`key`) for that model
- **Agent server running** when using `jobs schedule`, so that prompts can be processed.
- The Greg **workspace directory** must be writable (used to store `jobs.json`).

If no valid primary model with an API key exists, job creation will fail.

## Commands

### add \<description\>

Create a new job from a natural-language description that includes both the schedule and the task. The CLI uses the primary LLM to parse the description into:

- **cronTime**: a 6‑field cron expression (`second minute hour day-of-month month day-of-week`)
- **jobPrompt**: the exact instruction that will be sent to the agent when the job runs

```bash
# Examples
bun run scripts/jobs add "every day at 6pm, send me a brief summary of tomorrow’s calendar"
bun run scripts/jobs add "every 30 minutes, remind me to stand up"
bun run scripts/jobs add "every weekday at 9:00, summarize my unread important emails"
```

On success it prints:

- `cronTime: ...`
- `jobPrompt: ...`
- `id: <generated-id>`

The job is appended to `jobs.json`.

### list

List all scheduled jobs currently stored in `jobs.json`.

```bash
bun run scripts/jobs list
```

Output shows, for each job:

- the job **id** (cyan)
- `cronTime`
- `jobPrompt`

If there are no jobs, it prints `No jobs in <path-to-jobs.json>`.

### remove \<id\>

Remove a job by its `id` (as shown in `add` output or `list`).

```bash
bun run scripts/jobs remove <id>
```

Behavior:

- If the id exists, the job is removed from `jobs.json` and `Removed job <id>` is printed.
- If the id does **not** exist, an error is printed and the process exits with a non‑zero status.

### schedule

Start the cron scheduler that reads `jobs.json` and runs jobs at their configured times. This is a **long‑running process**; keep it running in the background (e.g. in a terminal tab or supervisor).

```bash
bun run scripts/jobs schedule
```

Behavior:

- Loads all jobs from `jobs.json` and creates cron jobs for each.
- Logs how many jobs were loaded.
- If there are no jobs, logs `No jobs in <path-to-jobs.json>` but continues watching.
- Watches the workspace directory for changes to `jobs.json`:
  - when the file changes, existing cron jobs are stopped
  - jobs are reloaded and new cron jobs are created

At each scheduled time:

- Logs a timestamped line indicating which job is running (with a shortened preview of the `jobPrompt`).
- Opens a new agent thread and sends the `jobPrompt`.
- Streams the model output to stdout.
- Logs any errors encountered while running the job.

Use this when the user wants Greg to **continuously run recurring tasks** based on natural‑language schedules, such as reminders, summaries, or periodic reports.
