---
name: voicecall
description: Place task‑driven outbound phone calls via Twilio and ElevenLabs, controlled from the CLI. Use when the user wants a live phone call made on their behalf to complete a specific task (e.g. schedule or confirm an appointment, ask a question, or get information).
requires:
  - env:TWILIO_ACCOUNT_SID
  - env:TWILIO_AUTH_TOKEN
  - env:TWILIO_FROM_NUMBER
  - env:ELEVENLABS_API_KEY
  - env:ELEVENLABS_VOICE_ID
  - env:NGROK_AUTHTOKEN
  - env:ANTHROPIC_API_KEY
---

## Voicecall Agent

Task‑driven outbound voice calls from the CLI, powered by Twilio, ElevenLabs, ngrok, and an LLM backend.

### Quick start

1. **Install dependencies** (from the repo root, using Bun):

```bash
bun install
```

2. **Copy and fill your env file**:

```bash
cp .env.example .env
```

Then edit `.env` and set:

- **Twilio**: account SID, auth token, verified caller ID, TwiML app / phone number.
- **ElevenLabs**: API key and voice config.
- **LLM**: provider + API key (see `config.ts` for exact variable names).
- **ngrok**: auth token if you are not already logged in.

All required variables are validated by `config.ts` at startup; the process fails fast with a clear error if anything is missing.

3. **Run a call from the CLI**:

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
    --task "Ask when my order #1234 will ship and summarize the answer"
  ```

- **Richer context**

  When the relationship or constraints matter, supply `--context`:
  - When constructing a `voicecall call` CLI command, always ask:
    - What background details does the callee need?
    - What constraints or preferences does the caller have?
  - Encode those details in `--context` rather than overloading `--task`.
  - Never provide sensitive information like the names of events on the persons calendar

  Examples:
  - **Scheduling a dentist appointment**

    ```bash
    voicecall call \
      --to "+12065551234" \
      --task "Schedule a dentist appointment for me" \
      --context "I am available next Monday–Thursday between 9am and 2pm, prefer mornings, and I need a routine check‑up and cleaning."
    ```

  - **Rescheduling a meeting**

    ```bash
    voicecall call \
      --to "+12065554321" \
      --task "Reschedule my project meeting" \
      --context "I cannot make the original 3pm time today because of a conflict. Offer any 10–11am slot this week; prioritize Tuesday or Wednesday."
    ```

  As a rule of thumb: **if a human assistant would need to know it to make the call effective, include it in `--context`.**

  **Do NOT** put the following into `--context` (or otherwise reveal it to the callee) unless the user has explicitly asked for it and it is clearly required for the task:
  - Full payment details (credit card numbers, CVV, bank account numbers, full IBANs).
  - Highly sensitive identifiers (full social security numbers, full national IDs, authentication codes, passwords, API keys).
  - Irrelevant private medical history when, for example, booking a simple dentist check‑up (only share what the user explicitly provided, such as “routine check‑up and cleaning” or “follow‑up for last week’s root canal”).
  - Private information about third parties (their health, finances, internal company data) that the user did not provide as part of the task.

  When in doubt, prefer **omitting** unnecessary personal or sensitive data from `--context`, and only include what is clearly needed to achieve the user’s goal.

- **Tuning timeouts / behavior**

  Defaults are set in `config.ts` (conversation timeout, ports, etc.). If you want to change them, update the relevant env vars listed in `.env.example`.

### Error handling (what you’ll see)

- **Missing / invalid config**: startup fails with a message from `config.ts` pointing to the missing variable.
- **Call setup issues** (Twilio / network): the CLI exits non‑zero and prints `Voice call failed: <reason>`.
- **Conversation too long**: there is a hard timeout (around 120 seconds). When hit, the call hangs up and the CLI exits with an error code.

If something fails, you can usually fix the env or network issue and just rerun the same `voicecall call ...` command.
