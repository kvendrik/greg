---
name: jobs-cli
description: Manage scheduled LLM jobs via Greg’s jobs CLI. Use when the user wants recurring tasks or automations that run prompts on a schedule (add, list, remove, and run cron-based jobs stored in jobs.json).
---

# Jobs CLI (scheduled prompts)

Manage recurring, cron-based jobs that send prompts to Greg’s primary LLM. Jobs are stored in `jobs.json` in Greg’s workspace directory and executed via the agent server.

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

From the **repo root** (the path from your system prompt: **"The code you're running on is at: ..."**), always use `bun` and the `scripts/jobs` entry point:

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

Before running any command:

- Tell the user which subcommand you are going to run and why.
- For `add`, restate the interpreted schedule and behavior in your own words.

## Requirements

- **Primary model configured** in `.greg` with a `role: "primary"` entry that includes:
  - a valid `model` string
  - an API key field (`key`) for that model
- **Agent server running** when using `jobs schedule`, so that prompts can be processed.
- The Greg **workspace directory** must be writable (used to store `jobs.json`).

If no valid primary model with an API key exists, job creation will fail.

If any requirement is missing:

- Explain clearly which prerequisite is missing (primary model, API key, agent server, or writable workspace).
- Tell the user which file or command they need to configure.
- Do not keep retrying failing commands.

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

**Agent behavior:**

1. After running `add`, repeat back to the user:
   - The parsed `cronTime`.
   - The `jobPrompt` that will run.
   - The generated `id`.
2. Ask the user to confirm that this behavior matches what they intended. If it does not, suggest adjusting the natural-language description and running `add` again.

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

When listing jobs for the user:

- Present them as a **numbered list** with `id`, a human-readable schedule (if you can infer it), and a short preview of `jobPrompt`.
- If there are many jobs, focus on the ones that are relevant to the user’s current question.

### remove \<id\>

Remove a job by its `id` (as shown in `add` output or `list`).

```bash
bun run scripts/jobs remove <id>
```

Behavior:

- If the id exists, the job is removed from `jobs.json` and `Removed job <id>` is printed.
- If the id does **not** exist, an error is printed and the process exits with a non‑zero status.

Always confirm with the user before removing a job:

- Show them which job (`id`, schedule, and `jobPrompt`) you are about to remove.
- Ask explicitly if they want to proceed, then run `remove <id>` only after confirmation.

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

When explaining `schedule` to the user:

- Make it clear that this process must stay running for jobs to execute.
- Suggest running it in a long‑lived terminal tab or process manager.
- If the user wants notifications elsewhere (e.g. Telegram, email), explain that `jobPrompt` should include instructions for where and how to send results, and that additional skills may be involved.
