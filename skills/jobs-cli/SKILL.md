---
name: jobs-cli
description: Manage scheduled LLM jobs via cron tools and greg cron CLI. Use when the user wants recurring tasks or automations that run prompts on a schedule (add, list, remove, run cron-based jobs stored in workspace/cron/jobs.json).
---

# Cron jobs (scheduled prompts)

Manage recurring, cron-based jobs that send prompts to Greg’s primary LLM. Jobs are stored in `workspace/cron/jobs.json` and run automatically when the gateway is running.

## When to use this skill

Use this skill when the user:

- Wants a **recurring or scheduled task** (e.g. “every day at 6pm, do X”).
- Needs a **cron-like automation** that runs prompts without manual intervention.
- Asks to **list, update, or remove** existing scheduled jobs.

Do **not** use this skill when:

- The user is asking for a **one-off** action that can be done immediately (just run the prompt once instead).
- The agent server or primary model is not configured; explain the prerequisites first.

Always confirm the **intended schedule and behavior** with the user before creating or deleting jobs.

## How to run

You have **cron tools** and the **greg cron CLI**.

### Using cron tools (preferred)

Use the agent tools to manage jobs from the conversation:

- **cron_add** — Add a job. Parameters: `schedule` (object with `kind`: `"cron"` with `expr` and optional `tz`, or `"every"` with `everyMs`, or `"at"` with `at` for one-shot), `jobPrompt`, optional `name`, optional `staggerMs`, optional `deleteAfterRun` (for one-shot "at" jobs). Example: `schedule: { kind: "cron", expr: "0 0 18 * * *", tz: "Europe/Amsterdam" }` for 6pm daily in that timezone.
- **cron_list** — List all jobs with id, schedule, name, and jobPrompt preview.
- **cron_remove** — Remove a job by `jobId`.
- **cron_update** — Update a job’s schedule, jobPrompt, name, enabled, staggerMs, or deleteAfterRun by `jobId`.
- **cron_run** — To run a job immediately, the user must run `greg cron run <jobId>` in the terminal (gateway must be running).

Schedule kinds: **cron** (recurring by expression + optional `tz`), **every** (recurring every N ms, `everyMs`), **at** (one-shot at an ISO date). Use optional `staggerMs` to delay execution and spread load; use `deleteAfterRun: true` with **at** to remove the job after it runs once. Config `cron.maxConcurrentRuns` (default 1) limits how many jobs run at the same time. Config `cron.retry` (e.g. `maxAttempts`, `backoffMs`, `retryOn`: substrings to match in error messages) retries failed runs when the error matches.

### Using the CLI

From the repo root, use the greg cron subcommands. Use **exactly one** of `--cron`, `--every`, or `--at` when adding.

```bash
# Add a cron job (6-field expression; optional --tz)
greg cron add --cron "0 0 18 * * *" --prompt "Daily summary" [--name "Daily summary"] [--tz Europe/Amsterdam] [--stagger 5000]

# Add an interval job (every N ms)
greg cron add --every 60000 --prompt "Check inbox" [--name "Minutely"]

# Add a one-shot job (run at ISO date/time; optional --delete-after-run)
greg cron add --at "2025-03-20T09:00:00Z" --prompt "One-time reminder" [--delete-after-run]

# List jobs
greg cron list

# Show recent run history
greg cron runs [--limit 50]

# Update a job (omit options to leave unchanged)
greg cron update <jobId> [--cron "0 0 8 * * *"] [--tz Europe/Amsterdam] [--prompt "New prompt"] [--name "New name"] [--enabled true|false] [--stagger 1000] [--delete-after-run] [--no-delete-after-run]

# Remove a job
greg cron remove <jobId>

# Run a job once now (gateway must be running)
greg cron run <jobId>
```

Cron expression is **6-field**: second, minute, hour, day-of-month, month, day-of-week. Examples: `0 0 18 * * *` = 6pm daily; `0 */30 * * * *` = every 30 minutes. Use optional `--tz` (CLI) or `schedule.tz` (tool) for IANA timezone; otherwise the gateway server’s local timezone is used. Job list and add/update are **hot-reloaded** by the gateway (no restart needed).

## Requirements

- **Primary model configured** in `.greg` with a valid API key.
- **Gateway running** (`greg gateway`) for jobs to run on schedule and for `greg cron run`.
- **Writable workspace** so jobs can be stored in `workspace/cron/jobs.json`.

If any requirement is missing, explain which one and how to fix it.

## Behavior

- After **cron_add** (tool or CLI), repeat back the cronTime, jobPrompt, and id; ask the user to confirm.
- Before **cron_remove**, confirm which job (id, schedule, jobPrompt) will be removed.
- **cron_run** from the LLM cannot run jobs immediately; tell the user to run `greg cron run <jobId>` in the terminal.
- The gateway runs the cron scheduler; jobs execute automatically at their scheduled times. Changes to jobs (add/remove/update) are picked up automatically; no restart needed.
