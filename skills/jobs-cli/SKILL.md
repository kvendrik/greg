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

- **cron_add** — Add a job. Parameters: `cronTime` (6-field cron expression), `jobPrompt` (text sent to the agent), optional `name`. Example: `cronTime: "0 0 18 * * *"` for 6pm daily (second minute hour day-of-month month day-of-week).
- **cron_list** — List all jobs with id, cronTime, name, and jobPrompt preview.
- **cron_remove** — Remove a job by `jobId`.
- **cron_update** — Update a job’s cronTime, jobPrompt, name, or enabled by `jobId`.
- **cron_run** — To run a job immediately, the user must run `greg cron run <jobId>` in the terminal (gateway must be running).

For natural-language schedules, convert to a 6-field cron expression before calling **cron_add** (e.g. “every day at 6pm” → `0 0 18 * * *`, “every 30 minutes” → `0 */30 * * * *`).

### Using the CLI

From the repo root, use the greg cron subcommands:

```bash
# Add a job (6-field cron + prompt)
greg cron add --cron "0 0 18 * * *" --prompt "Send me a summary of tomorrow's calendar" --name "Daily summary"

# List jobs
greg cron list

# Remove a job
greg cron remove <jobId>

# Run a job once now (gateway must be running)
greg cron run <jobId>
```

Cron expression is **6-field**: second, minute, hour, day-of-month, month, day-of-week. Examples: `0 0 18 * * *` = 6pm daily; `0 */30 * * * *` = every 30 minutes. Times are interpreted in the **gateway server’s local timezone** (no per-job timezone option).

## Requirements

- **Primary model configured** in `.greg` with a valid API key.
- **Gateway running** (`greg gateway`) for jobs to run on schedule and for `greg cron run`.
- **Writable workspace** so jobs can be stored in `workspace/cron/jobs.json`.

If any requirement is missing, explain which one and how to fix it.

## Behavior

- After **cron_add** (tool or CLI), repeat back the cronTime, jobPrompt, and id; ask the user to confirm.
- Before **cron_remove**, confirm which job (id, schedule, jobPrompt) will be removed.
- **cron_run** from the LLM cannot run jobs immediately; tell the user to run `greg cron run <jobId>` in the terminal.
- The gateway runs the cron scheduler; jobs execute automatically at their scheduled times. Restart the gateway after changing jobs (add/remove/update) so the scheduler reloads.
