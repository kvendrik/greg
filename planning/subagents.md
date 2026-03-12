## Features

### T1 plan: Subagents

- **Goal:** Let the main agent spawn background agent runs (subagents) that work in separate sessions and report results back, so cron/heartbeat or the user session can delegate work in parallel (e.g. morning briefing with parallel fetches).
- **Mechanism (OpenClaw-style):** Main agent calls a tool (e.g. `sessions_spawn`) with a `task` (instruction) and optional `model` / `skills` / `timeout`. Gateway creates a new session, runs the agent there; when the run finishes, an “announce” is delivered back to the requester session (main or cron-triggered run).
- **Scope for T1:**
  - Add `sessions_spawn` (or equivalent) tool: params `task`, optional `model`, `runTimeoutSeconds`, `onComplete` (or inline “when done, do X”).
  - Gateway: create subagent sessions (e.g. session id pattern `main::subagent:<runId>`), run prompt in that session, no need for nested spawn (depth 1 only).
  - On subagent completion: run an announce step (status, result summary, token/runtime if available) and deliver that as a message into the requester session so the main agent can use it.
  - Concurrency: single in-process queue/lane for subagent runs, with a configurable cap (e.g. `maxConcurrent: 4`).
- **Out of scope for T1:** Nested subagents (subagent spawning its own), thread-bound long-lived subagent sessions, `/subagents` slash commands; can add later if needed.
- **Integration:** Cron and heartbeat already call `session.prompt(...)` on the main session; that session’s agent can be given the new tool so scheduled runs can spawn subagents. No change to how cron/heartbeat are triggered; they just get an extra tool.
