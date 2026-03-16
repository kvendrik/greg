# Voice Calling

A TypeScript voice calling library built on Twilio, ElevenLabs (STT + TTS), and Claude.

## Files

- `voice.ts` — the server (start this first)
- `converse.ts` — CLI
- `sdk.ts` — TypeScript SDK
- `config.ts` — all configuration

## Setup

```bash
bun add twilio @ngrok/ngrok @elevenlabs/elevenlabs-js @mariozechner/pi-coding-agent @mariozechner/pi-ai ws commander
cp .env.example .env
# fill in .env
```

## Usage

```bash
# Terminal 1 — start the server
bun voice.ts

# Terminal 2 — use the CLI
bun converse.ts call --to "+31612345678" --message "Hi" --task "Confirm the 3pm meeting"
bun converse.ts status --call-id CA1234
bun converse.ts speak  --call-id CA1234 --message "One moment"
bun converse.ts end    --call-id CA1234
bun converse.ts tail
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `call --to --message [--mode] [--task] [--timeout]` | Place an outbound call |
| `continue --call-id --message` | Inject a message through Claude |
| `speak --call-id --message` | Speak directly, bypassing Claude |
| `end --call-id` | Hang up |
| `status --call-id` | Get status and transcript |
| `tail` | Stream live server logs |
| `expose --mode` | Create a public tunnel |

## Control API

```bash
POST   /calls                      # initiate
GET    /calls/:id                  # status
POST   /calls/:id/continue         # continue through Claude
POST   /calls/:id/speak            # speak directly
DELETE /calls/:id                  # end
GET    /logs                       # SSE log stream
```
