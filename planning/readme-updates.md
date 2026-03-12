# README update plan

Based on reading `README.md` and comparing it to the current codebase (bin/greg.ts, gateway, config, cron, skills, hub).

---

## 1. Fix truncated ending

**Current:** The README ends mid-sentence: “So give a quick overview” (Guard section).

**Action:** Complete the Guard section. Either add a short overview of what the guard does (ModernBERT classifier, off by default, how to enable) and close the section, or remove the incomplete sentence.

---

## 2. Scheduled Jobs section — wrong commands and scheduler description

**Current:**

- Uses `greg jobs add "Every day at 6am send me a list of my unread emails"`.
- Says to keep the scheduler running with `greg jobs schedule`.

**Reality:**

- The CLI is under **`greg cron`**, not `greg jobs`. Commands: `greg cron add`, `greg cron list`, `greg cron run <jobId>`, `greg cron update`, `greg cron remove`, `greg cron runs` (run history).
- Adding a job uses options, not natural language: e.g. `greg cron add --cron "0 0 6 * * *" --prompt "send me a list of my unread emails"` (and optionally `--tz`, `--name`, etc.). There is no `greg jobs schedule`; the cron scheduler runs **inside the gateway** when `config.cron?.enabled` is true (default), so you only need `greg gateway start`.

**Action:** Rewrite the “📆 Scheduled Jobs” section to:

- Use `greg cron add` with `--cron` / `--every` / `--at` and `--prompt`.
- Say that the scheduler runs with the gateway (`greg gateway start`) and that cron can be disabled via config.
- Optionally mention `greg cron list`, `greg cron run <id>`, and `greg cron runs` for history.

---

## 3. Sessions command

**Current:** “Easiest way is to use the CLI: `greg gateway sessions create`”.

**Reality:** Sessions are a top-level command: **`greg sessions create`** (not under `gateway`). Also `greg sessions list`, `greg sessions prompt <sessionId> <text>`.

**Action:** Replace `greg gateway sessions create` with `greg sessions create`. Fix the typo “When used to the gateway” → e.g. “When connected to the gateway” or “Once the gateway is running”.

---

## 4. Config example

**Current:** `import { Config, validate } from './config'`.

**Reality:** The repo’s `.greg.ts` only imports `Config` from `./config`; `validate` is not used in the config file.

**Action:** Use `import { Config } from './config'` in the README config snippet (or match the repo’s `.greg.ts` exactly). Optionally add a short note that `greg config validate` exists to validate the config.

---

## 5. Config type link and optional features

**Current:** “(See the [`Config type`](/config/types.ts)) for all config options)” — path is correct.

**Reality:** Config has more than the README shows: `cron` (e.g. `enabled`, `store`), `heartbeat` (e.g. `enabled`, `intervalMs`, `activeHours`), etc.

**Action:** Keep or fix the Config link (e.g. `config/types.ts` if relative). Optionally add one line that config can enable/disable cron and heartbeat, and point to the type for full options.

---

## 6. Skills and hub

**Current:** “These are available in `/hub`. Greg already knows how to use them but they require auth tokens.”

**Reality:** Repo has a **`hub/`** directory (e.g. `hub/strava.ts`, `hub/notion.ts`) for CLIs. Agent skills are in **`skills/`** (Markdown `SKILL.md` files); see `skills/README.md`. So “in `/hub`” is the hub CLIs; skills live in project/workspace `skills/`.

**Action:** Clarify that hub CLIs are in the `hub/` directory (or “in hub”). No change needed if “/hub” is meant as a path; optionally add that skills are in the `skills/` directory and mention `greg doctor` for checking skill/hub requirements.

---

## 7. New features worth mentioning (optional)

- **Heartbeat:** Periodic runs from `HEARTBEAT.md` when `config.heartbeat?.enabled` is true; runs in the gateway.
- **`greg doctor`:** Validates config and checks skill dependencies (CLIs and env vars from skill `requires`).
- **`greg config validate`** and **`greg config path`** for config management.
- **`greg cron runs`** to show recent cron run history.

---

## 8. Setup flow

**Current:** Step 4 says to run `greg gateway sessions create` and then “When used to the gateway you can start using Telegram…”.

**Action:** After fixing the sessions command (see §3), clarify that the gateway must be running (`greg gateway start`) before creating sessions or using Telegram, and that `greg gateway start` is long-running (or started via pm2).

---

## Summary checklist

| Item                       | Priority | Change                                                      |
| -------------------------- | -------- | ----------------------------------------------------------- |
| Truncated Guard section    | High     | Complete or remove “So give a quick overview”               |
| Scheduled Jobs commands    | High     | Switch to `greg cron` and gateway-based scheduler           |
| Sessions command           | High     | `greg sessions create` (not `greg gateway sessions create`) |
| “When used to the gateway” | Medium   | Fix typo / wording                                          |
| Config import              | Low      | Drop `validate` from example or add note                    |
| Config / optional features | Low      | Link + optional line on cron/heartbeat                      |
| Skills vs hub              | Low      | Clarify hub vs skills, optional `greg doctor`               |
| New features               | Optional | Heartbeat, doctor, config validate, cron runs               |
