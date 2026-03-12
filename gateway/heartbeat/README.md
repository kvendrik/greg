# Heartbeat

Periodic agent turns in the main session so the model can surface what needs attention (check-ins, follow-ups, HEARTBEAT.md checklist) without spamming you. OpenClaw-style.

## What it does

- **Timer** runs at a fixed interval (default 30 minutes). Each tick reads `HEARTBEAT.md` from the workspace, builds a prompt, and runs it in the main session via a callback you provide.
- **HEARTBEAT.md** is your checklist: “check inbox”, “light check-in if daytime”, etc. The agent is instructed to reply `HEARTBEAT_OK` when nothing needs attention, or only the alert text otherwise.
- **Ack handling:** If the assistant reply is `HEARTBEAT_OK` (or has it at start/end with little else), the session storage does not persist that message, so the main thread stays clean.
- **Active hours** (optional) limit runs to a time window (e.g. 08:00–22:00 in your timezone). Outside the window the run is skipped and the next tick is scheduled as usual.
- **Run log** is written to `workspace/heartbeat/runs.jsonl` (startedAt, finishedAt, success, error). Pruned by `runLog.maxBytes` / `keepLines` when set.
- **Overlap guard:** If a run is still in progress when the next tick fires, that run is skipped and the next one is scheduled at the next interval.

## Why

So the agent can do lightweight, periodic check-ins and background checks (inbox, reminders, HEARTBEAT.md items) without you having to remember to ask. The gateway runs the timer; the main session gets the prompts.

## How to use

**From the gateway:** Start the heartbeat and pass a function that runs a prompt in the main session (and, if you want ack filtering, pass `heartbeatAckMaxChars` into the session so it can drop ack-only replies):

```ts
import { startHeartbeat } from './heartbeat';

const stopHeartbeat = startHeartbeat(
  { workspace: config.workspace },
  (instruction: string, opts) => {
    return runPromptInMainSession(instruction, {
      heartbeatAckMaxChars: opts?.ackMaxChars,
    });
  },
  config.heartbeat
);
// On shutdown: stopHeartbeat();
```

**Config (optional):** In `.greg` set `heartbeat`:

```ts
heartbeat: {
  enabled: true,                    // false = heartbeat off
  intervalMs: 30 * 60 * 1000,      // how often to run (default 30 min)
  activeHours: { start: '08:00', end: '22:00', timezone: 'Europe/Amsterdam' },
  prompt: '…',                      // full instruction text; if set, replaces the default. HEARTBEAT.md content is still appended after "---"
  ackMaxChars: 300,                // if the reply is HEARTBEAT_OK (or that + up to this many chars), the message is not persisted. Raise to allow short notes with the ack; lower to drop more
  jitterMs: 60_000,                // optional: max jitter for the first run after a cold start. Default is 10% of intervalMs (clamped to intervalMs). Set 0 to disable. Actual delay = base schedule + random 0–jitterMs ms
  target: 'last',                  // "last" = main session (default). "none" reserved for future routing
  runLog: { maxBytes: 500_000, keepLines: 500 },  // where to cap heartbeat/runs.jsonl; pruned when over maxBytes, keeping last keepLines lines
}
```

**HEARTBEAT.md** in your workspace (optional). If missing or empty, the agent still gets the default instruction and can reply `HEARTBEAT_OK`. Example:

```md
- Quick scan: anything urgent in inboxes?
- If it's daytime, do a lightweight check-in if nothing else is pending.
```

## Files in this folder

- `types.ts` — Options, active hours, execute callback, run log entry.
- `ack.ts` — `processHeartbeatReply(replyText, ackMaxChars)` for HEARTBEAT_OK stripping and ack detection.
- `active-hours.ts` — `isWithinActiveHours(activeHours)` for the time window check.
- `run-log.ts` — Append and prune `heartbeat/runs.jsonl`.
- `runner.ts` — Validates workspace, runs the timer, builds prompt from HEARTBEAT.md, calls your callback, logs runs, handles overlap and shutdown.
- `index.ts` — Re-exports `startHeartbeat`, `processHeartbeatReply`, and types.
