---
name: voicecall
description: Place task‑driven outbound phone calls via Twilio and ElevenLabs, controlled from the CLI. Use when the user wants a live phone call made on their behalf to complete a specific task (e.g. schedule or confirm an appointment, ask a question, or get information).
requires:
  - env:TWILIO_ACCOUNT_SID
  - env:TWILIO_AUTH_TOKEN
  - env:TWILIO_FROM_NUMBER
  - env:ELEVENLABS_KEY
  - env:ELEVENLABS_VOICE_ID
  - env:NGROK_AUTHTOKEN
  - env:ANTHROPIC_API_KEY
---

## Voicecall Agent

Task‑driven outbound voice calls from the CLI, powered by Twilio, ElevenLabs, ngrok, and an LLM backend.

**Provide as much context as possible.** Before running `voicecall call`, gather from the user (or from available data) every detail that would help the voice agent succeed: who is calling on whose behalf, relationship to the callee, time preferences, constraints, fallback options, and any other background the callee might need. Put that into `--context`. A call with rich, specific context is far more likely to succeed than one with minimal context.

### Quick start

1. **Install dependencies** (from the repo root, using Bun):

```bash
bun install
```

2. **Set required env variables** (see `./config.ts` for the full list):

- **Twilio**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- **ElevenLabs**: `ELEVENLABS_KEY`, `ELEVENLABS_VOICE_ID`
- **LLM**: `ANTHROPIC_API_KEY`
- **ngrok**: `NGROK_AUTHTOKEN`

The CLI throws at startup with a clear error if any required variable is missing.

3. **Check CLI health** — run `voicecall doctor` to ensure env and config are OK before placing calls. Use it when troubleshooting failures.

```bash
voicecall doctor
```

4. **Run a call from the CLI**:

From the repo root:

```bash
voicecall call \
  --to "+12065551234" \
  --task "Confirm tomorrow's dentist appointment and note the time" \
  --context "You are my assistant calling my dentist. Be brief and polite."
```

- **`--to`**: E.164 phone number to dial.
- **`--task`**: What you want the agent to accomplish.
- **`--context`**: Extra background or constraints.

The CLI will:

- Place the call.
- Talk to the callee using the LLM + TTS.
- Print a final **conclusion** and brief transcript once the task is done.

### Typical usage patterns

- **Quick one‑off task**

  Ask the agent to complete a single, concrete task:

  ```bash
  voicecall call \
    --to "+12065551234" \
    --task "Ask when my order #1234 will ship and summarize the answer" \
    --context "You are my assistant."
  ```

- **Richer context (default behavior)**

  **Always supply as much useful context as you can** in `--context`. Do not default to a minimal one-liner; treat context as the main lever for call success.
  - When constructing a `voicecall call` CLI command, always ask:
    - What background details does the callee need?
    - What constraints or preferences does the caller have?
    - Especially for **times and scheduling**, prefer giving a **time range or multiple acceptable options** instead of a single exact time.
  - Encode those details in `--context` rather than overloading `--task`.
  - Never provide sensitive information like the names of events on the persons calendar

  Examples:
  - **Scheduling a dentist appointment**

    ```bash
    voicecall call \
      --to "+12065551234" \
      --task "Schedule a dentist appointment for me" \
      --context "I am available next Monday–Thursday between 9am and 2pm, prefer mornings, and I need a routine check‑up and cleaning. If 9am is not available, any time between 9am and 11am on those days is fine."
    ```

  - **Rescheduling a meeting**

    ```bash
    voicecall call \
      --to "+12065554321" \
      --task "Reschedule my project meeting" \
      --context "I cannot make the original 3pm time today because of a conflict. Offer any 10–11am slot this week; prioritize Tuesday or Wednesday."
    ```

  As a rule of thumb: **if a human assistant would need to know it to make the call effective, include it in `--context`.** When in doubt, include it—more context (within the safety rules below) is better than less.

  **Do NOT** put the following into `--context` (or otherwise reveal it to the callee) unless the user has explicitly asked for it and it is clearly required for the task:
  - Full payment details (credit card numbers, CVV, bank account numbers, full IBANs).
  - Highly sensitive identifiers (full social security numbers, full national IDs, authentication codes, passwords, API keys).
  - Irrelevant private medical history when, for example, booking a simple dentist check‑up (only share what the user explicitly provided, such as “routine check‑up and cleaning” or “follow‑up for last week’s root canal”).
  - Private information about third parties (their health, finances, internal company data) that the user did not provide as part of the task.

  When in doubt, prefer **omitting** unnecessary personal or sensitive data from `--context`, and only include what is clearly needed to achieve the user’s goal.

- **Tuning timeouts / behavior**

  Defaults are set in `config.ts` (conversation timeout, ports, etc.). If you want to change them, update the relevant env vars or config in `config.ts`.

### Error handling (what you’ll see)

- **Missing / invalid config**: startup fails with a message from `config.ts` pointing to the missing variable.
- **Call setup issues** (Twilio / network): the CLI exits non‑zero and prints `Voice call failed: <reason>`.
- **Conversation too long**: there is a hard timeout (around 120 seconds). When hit, the call hangs up and the CLI exits with an error code.

If something fails, you can usually fix the env or network issue and just rerun the same `voicecall call ...` command.
