## Features

### T1 plan: Greg system presence

- **Goal:** Give operators and clients a way to see who and what is connected to the Greg gateway — connected clients (CLI, Telegram, web, etc.), the gateway itself, and any nodes — so UIs can show an “Instances” or “Presence” view and operators can inspect connectivity at a glance.
- **Mechanism (OpenClaw-style):** Gateway keeps a lightweight, best-effort presence store (in-memory or small persistence). Entries are added/updated when: the gateway starts (self-entry), a client connects (e.g. WebSocket/HTTP session), and optionally when clients send a “system-event” or beacon. Each entry has: `ts`, `reason`, `lastInputSeconds`, `mode` (e.g. cli, telegram, web), optional `version` / `host` / `instanceId`. Stale entries are pruned (e.g. TTL 5 min); cap total entries (e.g. 200); deduplicate by stable `instanceId` where available.
- **Scope for T1:**
  - Gateway: maintain a presence store (add/update on connect, optional beacon endpoint or event; prune stale; cap size).
  - CLI: `greg system presence` (or `greg gateway presence`) that lists current presence entries; optional `--json` for machine-readable output.
  - Presence payload: at least `ts`, `reason`, `mode`; optionally `lastInputSeconds`, `version`, `host`, `instanceId` if we have them from the transport.
- **Out of scope for T1:** Full OpenClaw parity (deviceFamily, modelIdentifier, ip); persistence across gateway restarts; presence-driven routing or auth. Can add later if needed.
- **Integration:** Gateway already has server and client connections (e.g. Telegram, HTTP); hook into connection lifecycle (and optional heartbeat/beacon) to update presence. No change to agent or cron/heartbeat logic; presence is read-only visibility.
