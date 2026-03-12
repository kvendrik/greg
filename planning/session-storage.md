## Session storage & compaction — OpenClaw reference

This note summarizes how OpenClaw stores session transcripts (`*.jsonl`), keeps them performant, and balances context quality vs. disk and load-time costs. It is meant as a design reference for Greg’s own session storage.

---

## 1. Storage model in OpenClaw

- **Two layers of persistence**  
  From the Session Management Deep Dive:[^session-deep-dive]
  - `sessions.json` — small key–value store mapping `sessionKey -> SessionEntry` with metadata (current `sessionId`, token counters, compaction counts, idle timestamps, etc.). Safe to edit, rotated and pruned by `session.maintenance`.
  - `*.jsonl` transcripts — append-only per-session log used to rebuild model context. Lives under `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl` on the gateway host.

- **On‑disk locations**[^session-deep-dive]  
  - Store: `~/.openclaw/agents/<agentId>/sessions/sessions.json`  
  - Transcripts: `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`  
  - Topic / channel variants (Telegram, Slack, etc.) are derived from `sessionKey` (e.g. `…/-topic-.jsonl`).

- **Transcript schema (`*.jsonl`)**  
  Each line is a JSON object; first line is a `type: "session"` header, subsequent lines are entries with an `id` and optional `parentId` forming a tree.[^session-deep-dive] Important entry types:
  - `message` — user / assistant / `toolResult` messages (with `message.role` and `message.content[]`).
  - `compaction` — persisted compaction summary with `firstKeptEntryId` and `tokensBefore`.
  - `branch_summary` — summary for non-main branches.
  - `custom` / `custom_message` — extension state / injected messages.

- **Message payloads & tool results**  
  The `session-logs` skill documents the JSONL message shape:[^session-logs]
  - Top-level: `{ "type": "session" | "message", "timestamp": ..., "message": { role, content, usage, ... } }`
  - `message.role`: `"user" | "assistant" | "toolResult"`.
  - `message.content[]`: content blocks (`type: "text" | "tool" | "thinking" | ...`), plus usage/cost metadata.
  - Tool call **results** are stored as `role: "toolResult"` messages so tools like `session-logs` and external viewers can analyze them.

**Implication for Greg:** OpenClaw keeps a rich, append-only JSONL that includes tool results and compaction summaries, and uses a separate, small `sessions.json` as an index and stats store.

---

## 2. How OpenClaw keeps sessions small & fast

OpenClaw layers several mechanisms to keep JSONL files and in‑memory context both performant and high quality:

### 2.1. Disk‑level maintenance (`session.maintenance`)

From the Session Management Deep Dive:[^session-deep-dive]

- **Budget and pruning controls**
  - `session.maintenance.maxDiskBytes` — optional total budget for the `sessions/` directory.
  - `session.maintenance.highWaterBytes` — target usage after cleanup (default ~80% of `maxDiskBytes`).
  - `session.maintenance.pruneAfter` — age cutoff for stale sessions (default `30d`).
  - `session.maintenance.maxEntries` — cap on entries in `sessions.json` (default `500`).
  - `session.maintenance.rotateBytes` — rotates `sessions.json` when oversized (default `10mb`).
  - `session.maintenance.resetArchiveRetention` — retention for archived `*.reset.*` transcripts.
  - `session.maintenance.mode`: `"warn"` (report only) or `"enforce"` (actually evict & delete).

- **Eviction order when enforcing**  
  When `mode: "enforce"` and disk use exceeds `maxDiskBytes`:
  1. Clean up until at or below `highWaterBytes`.
  2. Evict oldest sessions and remove their transcript files.
  3. Remove oldest archived / orphan transcript artifacts first.

- **Cron-specific controls**  
  - `cron.runLog.maxBytes` + `cron.runLog.keepLines` prune cron run JSONL logs.
  - `cron.sessionRetention` (default `24h`) prunes isolated cron sessions from the store.

**Takeaway:** Disk size is bounded independently of context compaction. Old or idle sessions can be fully evicted so the session directory stays small and fast to scan.

### 2.2. Context compaction (persistent summaries)

From `/compaction` and the deep dive:[^compaction][^session-deep-dive]

- **What compaction does**
  - Summarizes *older* conversation into a single `compaction` entry (with `summary`, `firstKeptEntryId`, `tokensBefore`).
  - Keeps recent messages intact.
  - Persists the summary in the JSONL, so future turns see:
    - The compaction summary.
    - All messages after the compaction point.

- **When auto‑compaction triggers (Pi runtime)**
  - Compaction is enabled by default in Pi:
    - `compaction.enabled: true`
    - `compaction.reserveTokens` and `compaction.keepRecentTokens` define thresholds.
  - After a successful turn, or when a model reports context overflow, Pi will:
    1. Check if `contextTokens > contextWindow - reserveTokens`.
    2. If so, compact and retry the turn with the compacted context.
  - OpenClaw may additionally enforce a **floor** on `reserveTokens` via `agents.defaults.compaction.reserveTokensFloor` (default ~20k tokens) to guarantee headroom for housekeeping turns.

- **Config knobs**
  - `agents.defaults.compaction.enabled` — on/off.
  - `agents.defaults.compaction.model` — override model for summarization (can be a stronger remote model or a separate local model).
  - `agents.defaults.compaction.reserveTokensFloor` — minimum reserved headroom.
  - `compaction.keepRecentTokens` — how many recent tokens to keep verbatim.
  - `compaction.identifierPolicy` — how to treat opaque IDs/handles in summaries (`"strict"` by default keeps them intact).

**Effect:** Compaction keeps transcripts usable indefinitely by converting distant history into durable summaries, while preserving enough recent raw messages for high‑fidelity reasoning.

### 2.3. Session pruning (in‑memory, tool‑result‑focused)

From `/concepts/session-pruning`:[^session-pruning]

- **Scope**
  - Runs **right before an LLM call**, affecting only the messages sent to the model, **not** the JSONL on disk.
  - Targets only `toolResult` messages; user and assistant messages are never modified.

- **Behavior**
  - Modes:
    - `mode: "off"` — disabled.
    - `mode: "cache-ttl"` — runs when the last Anthropic call for the session is older than `ttl` (default `5m`) to optimize prompt caching.
  - Operations:
    - **Soft trim**: for oversized tool results, keep head + tail slices (defaults ~1500 chars each), insert `...` and a note about original size.
    - **Hard clear**: for very large results, replace content with a placeholder like `"[Old tool result content cleared]"`.
  - Defaults when enabled:
    - `softTrim.maxChars ~ 4000`, `headChars ~ 1500`, `tailChars ~ 1500`.
    - `minPrunableToolChars ~ 50000` to avoid touching small results.
    - `keepLastAssistants: 3` — tool results after the last N assistant messages are eligible; newer ones are protected.
  - Tool selection:
    - `tools.allow` / `tools.deny` (with `*` wildcards); deny wins and image‑containing tool results are always skipped.

**Effect:** Pruning keeps the *live* prompt smaller and cheaper, especially for Anthropic’s cache‑TTL behavior, without losing important user/assistant turns or rewriting history on disk.

### 2.4. Tool‑result size caps & guards

OpenClaw has repeatedly hardened against large tool outputs bloating sessions.[^pr10915]

- **Persistence‑time truncation (tool result guards)**
  - Tool results are truncated *before* being written to session JSONL.
  - Earlier PRs proposed capping at ~32k characters; current main includes a `capToolResultSize` helper and a `HARD_MAX_TOOL_RESULT_CHARS` constant (~400k) to enforce a hard upper bound for persisted tool content.
  - Truncation is applied after any result‑transformation hooks so even decorated results are bounded.

- **Compaction oversize checks**
  - Compaction uses token‑based size estimation to decide which messages are candidates for summarization.
  - To handle pathological dense payloads (minified JSON, base64), a **character‑based fallback** check (~100k chars) ensures such messages are treated as “oversized” even if token estimation underestimates them.

**Effect:** Sessions avoid megabyte‑scale tool results, compaction can still succeed, and transcripts retain a short, model‑digestible representation of tool output.

---

## 3. Performance vs. quality trade‑offs

OpenClaw’s design gives a few clear principles we can emulate:

- **Separate “what the model sees” from “what we persist”**
  - JSONL is a full audit trail (within size caps) — including tool results and compaction summaries — so you can debug, search, and replay.
  - The *in‑memory prompt* can be much smaller due to pruning and compaction, without losing observability.

- **Bound size at multiple layers**
  - Per‑result caps (tool result truncation + pruning) prevent a single tool call from breaking a session.
  - Compaction maintains a long‑running session’s usability by summarizing older parts.
  - Disk maintenance and retention enforce global ceilings so listing and loading sessions stays fast.

- **Prefer summaries over hard deletion for important context**
  - Compaction summarizes; pruning primarily trims or clears tool results that tend to be noisy or reconstructible.
  - This keeps user‑visible decisions and narratives available while discarding low‑signal bulk.

- **Make limits configurable but safe by default**
  - Defaults (e.g. `reserveTokensFloor`, pruning thresholds, disk budgets) are conservative.
  - Operators can tune limits per‑agent depending on model capacity and hardware.

For Greg, this suggests:

- Keep session JSONL rich enough for debugging and search (including tool calls), but:
  - Enforce per‑message and per‑tool caps to avoid runaway growth.
  - Implement compaction and/or summarization to keep context windows healthy.
  - Use a lightweight index (`sessions.json`‑style) to avoid scanning all JSONL files on every operation.

---

## 4. Concrete ideas for Greg (inspired by OpenClaw)

These are not implemented yet; they are candidates derived from OpenClaw’s approach:

- **Disk maintenance**
  - Add a small `sessions.json`‑equivalent index with token counters and timestamps.
  - Implement periodic or on‑demand cleanup:
    - Evict oldest session files once total size exceeds a configurable budget.
    - Optionally archive or compress very old sessions.

- **Per‑message size caps**
  - Cap tool results and large assistant chunks before appending to JSONL.
  - Include a short placeholder note with the original approximate size.

- **Compaction**
  - Add a compaction pass that:
    - Summarizes earlier history into a synthetic `compaction` message.
    - Keeps the last N messages or last M tokens verbatim.
  - Trigger when:
    - Estimated context tokens exceed `contextWindow - reserveTokens`.
    - Or when a model returns “context overflow”.

- **In‑memory pruning**
  - Before each turn, trim old tool results when building the prompt, similar to OpenClaw’s session pruning:
    - Protect most recent assistant/user turns.
    - Soft‑trim long tool outputs into head/tail slices with a note.

---

## 5. References

- Session Management Deep Dive — OpenClaw docs (gateway, sessions.json, JSONL transcripts, maintenance, compaction triggers).[^session-deep-dive]  
- Compaction — OpenClaw docs (auto/ manual compaction, configuration, model overrides).[^compaction]  
- Session Pruning — OpenClaw docs (in‑memory tool‑result trimming, TTL‑aware behavior, defaults).[^session-pruning]  
- Session logs skill — OpenClaw skill docs (JSONL schema, message roles and content, toolResult representation).[^session-logs]  
- PR: fix session bloat from oversized tool results — OpenClaw GitHub (historical context for tool‑result truncation and compaction resilience).[^pr10915]

---

[^session-deep-dive]: `Session Management Deep Dive` — `https://docs.openclaw.ai/reference/session-management-compaction`.
[^compaction]: `Compaction` — `https://docs.openclaw.ai/compaction`.
[^session-pruning]: `Session Pruning` — `https://docs.openclaw.ai/concepts/session-pruning`.
[^session-logs]: `session-logs` skill docs — for example `https://app.unpkg.com/@gguf/claw@2026.2.4/files/skills/session-logs/SKILL.md`.
[^pr10915]: GitHub PR `fix: prevent session bloat from oversized tool results and improve compaction resilience` — `https://github.com/openclaw/openclaw/pull/10915`.

