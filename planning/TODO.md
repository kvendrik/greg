## Tier 0 - Bugs

- [ ] Clean up Telegram messaging. channelId should not be required for prompt()
- [ ] Add /1hour to allowlist commands
- [ ] Forbid modifying certains paths

- [ ] QMD `search_memory` is broken. QMD.healthy() is also broken. `greg tools memory_search --search-query "friends"`
- [ ] Add tests to ensure Telegram and QMD keep working
- [ ] Fix other `bun test` failures
- [ ] Remove classifier and tighten up `exec()` security by improving allowlist and path policy checks

## Tier 1 — Core to the OpenClaw-style experience

Features users expect for “it just works” daily use: automation that delivers, context the agent can search, safe exec, and briefings that reach them where they are.

- [ ] **Subagents** — Main agent spawns background runs that report back; cron/heartbeat can parallelize (e.g. morning briefing in one run). See `planning/subagents.md`.  
       **Touches:** `agent/tools/` (new tool e.g. sessions_spawn), `gateway/sessions/` (create/run subagent sessions, announce back), `gateway/index.ts` (runPromptInMainSession), `agent/tools/cron/runner.ts`, `agent/Agent.ts` (tool registration).
- [x] **Search through transcripts** — Make search over session transcripts possible so Greg can use past conversations and notes (follow-ups, "why am I following up", link in notes).  
       **Touches:** `agent/tools/memory/` (memory_search scope sessions/both, memory_summarize, memory_get), `agent/tools/memory/qmd.ts`, workspace `sessions/*.jsonl`; session-logs skill.
- [ ] **Pre-exec policy for dangerous patterns** — Pre-exec approval exists; add policy that auto-blocks dangerous patterns so exec/shell is safe by default.  
       **Touches:** `agent/tools/exec.ts`, `agent/tools/utilities/guard/` (policy/policy.ts, allowlist, command-parser, patterns or new blocklist), config if policy is configurable.
- [ ] **Exec policy refactor: policy/exec/\* + 15s messaging timeout** — Move exec policy into a dedicated `policy/exec/*` folder: `policy.ts` for `evaluateExecPolicy()`, allowlist module and defaults, and new `permission.ts` for Telegram messaging logic (extracted from current guard policy). Add 15s timeout on permission messaging; when it expires, return that the user didn’t respond instead of waiting indefinitely.  
       **Touches:** New `agent/tools/utilities/guard/policy/exec/` (policy.ts, allowlist, permission.ts), current `agent/tools/utilities/guard/policy/policy.ts` (wire to exec or remove); sendMessage/awaitReply path for timeout.
- [ ] **Messaging CLIs for morning updates** — Add CLIs for WhatsApp, Telegram, and iMessage so cron/heartbeat briefings can be delivered into those apps (Telegram already has `greg telegram send`; extend pattern for WhatsApp/iMessage).  
       **Touches:** `bin/greg.ts` (new subcommands e.g. greg whatsapp send, greg imessage send), `clients/telegram/send-message.ts` (pattern to mirror), new clients/whatsapp/, clients/imessage/ or shared messaging layer; gateway cron/heartbeat delivery path if we add send-to-channel.

---

## Tier 2 — High value, rounds out daily use

Improves reliability, operator visibility, and memory quality without being the first thing users set up.

- [ ] **Web search retry and fallback** — Limit retries (e.g. 1–2 distinct failures), then mark search unavailable and move on; implement alternative search where possible to avoid latency and noise.  
       **Touches:** `agent/tools/web-search/web-search.ts` (retry count, fallback to second provider), `agent/tools/web-search/searchProviders/brave.ts`, `agent/tools/web-search/searchProviders/gemini.ts` (error handling); possibly `agent/tools/web-fetch/` if used as fallback.
- [ ] **Greg system presence** — Gateway tracks connected clients and itself; `greg system presence` (or `greg gateway presence`) for operator/UI visibility. See `planning/presence.md`.  
       **Touches:** `gateway/` (new presence store, hook into server and client connection lifecycle), `gateway/server.ts` (connections); `bin/greg.ts` (new command e.g. greg system presence or greg gateway presence); new `gateway/presence/` or similar.
- [ ] **Notes with links** — When saving notes like "Showed Koen X", also persist the link where possible; full transcript search would make this more complete.  
       **Touches:** `agent/tools/memory/index.ts` (memory_note params, saveConversationNote), note format in workspace notes/YYYY-MM-DD.md; optionally memory_search/memory_get if we index links.
- [ ] **Audio briefing delivery (TTS)** — Deliver morning or cron briefings as spoken audio (e.g. 3–5 min TTS) to Telegram or other channels so users can listen instead of read; OpenClaw users often cite this as a key briefing experience.  
       **Touches:** `gateway/index.ts` or cron/heartbeat runner (option to TTS the output before delivery), `scripts/voice.ts` (TTS helpers), `clients/telegram/` (send voice message if API supports); or new pipeline: cron/heartbeat → agent output → TTS → send to channel.
- [ ] **Email/inbox workflow** — First-class support for scheduled email digest (cron + gog skill) and safe send-with-approval flow so "inbox zero" / triage is a clear workflow (skills exist; wiring and approval UX can be improved).  
       **Touches:** `skills/google-cli/` (gog usage, possibly send flow), `agent/tools/utilities/guard/` or approval path for “send email” (if we gate it), `agent/tools/cron/` (scheduled digest prompt); config or docs for recommended cron + gog setup.

---

## Tier 3 — Nice-to-have

Useful for power users or edge cases; not required for the core loop.

- [ ] **Calls** — Give Greg a way to make calls (voice/telephony).  
       **Touches:** New integration (e.g. Twilio, Telnyx) or `clients/`; `agent/tools/` (new tool or skill); `bin/greg.ts` if CLI-triggered.
- [ ] **Voice mode (input)** — Talk to Greg by voice (wake word, voice-in); `scripts/voice.ts` and Telegram voice messages exist; make it a first-class, discoverable flow.  
       **Touches:** `scripts/voice.ts`, `clients/telegram/` (voice message handler, gateway.ts/service.ts), `bin/greg.ts` (e.g. greg voice); docs/skills for discoverability.
- [ ] **Follow-up tracking** — Proactive reminders to follow up on past conversations (e.g. "follow up with Sarah"); heartbeat + memory can support this; may need a light nudge/workflow layer.  
       **Touches:** `gateway/heartbeat/` (runner, HEARTBEAT.md or prompt injection), `agent/tools/memory/` (memory_search for “follow up” context); optionally new small module for nudge logic or HEARTBEAT content shape.
- [ ] **Tool error → GH issue** — When a tool has an error, Greg can create a GH issue for himself to track it.  
       **Touches:** `agent/Agent.ts` or tool execution path (where tool errors are caught), new tool or skill to create GitHub issues; possibly `agent/tools/index.ts` or error callback layer.

---

## Bugs

- [x] After a `/stop` call and a new prompt the agent continues where it left off.  
       **Touches:** `agent/Agent.ts` (abort, replaceMessages(previousMessages)), `gateway/sessions/` (storage: messages persisted/restored); flow of /stop → abort → next prompt using same session state.
- [ ] Sometimes numbers don't have spaces before them in messages.  
       **Touches:** Likely response formatting or model output; could be `agent/`, `gateway/server.ts`, `clients/telegram/` (prompt or display); narrow by repro (CLI vs Telegram).
