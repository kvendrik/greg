---
name: telegram-messaging
description: 'How to send messages to the user via Telegram using greg telegram send'
---

# Telegram Messaging

## Overview

This workspace has a built-in Telegram messaging capability. Use the `greg telegram send` command to send messages to the user. Messages can be sent as **text** or as **voice messages** (ElevenLabs TTS). If voice is requested but not configured or the voice API fails, the message is sent as normal text instead.

## When to use this skill

Use Telegram messaging when:

- You want to send **short notifications or alerts** about job status, errors, or important events.
- You need to send the user a **concise summary** of results from a long-running process.
- The user explicitly asks to **receive updates via Telegram**.
- You need to **ask the user a question** and use their reply in the next step (the agent does this via the Telegram service’s await-reply channel when e.g. confirming a guarded command).

Use **voice messages** when:

- The user prefers or requested voice updates.
- The message is short and benefits from being spoken (e.g. a quick confirmation or alert).

When composing the actual text for a **voice message**, also activate the `voice-message` AgentSkill so the output is written and tagged for ElevenLabs `eleven_v3` (audio tags, voice-friendly phrasing, and length limits).

Avoid using this skill for:

- Extremely long logs or outputs that will be unreadable in a messaging app.
- Highly sensitive data that should not leave the local environment (unless the user explicitly insists).

## How to Send Messages

Run from the **repo root** (the directory where `greg` and `package.json` live). Your system prompt gives this as **"The code you're running on is at: ..."** — use that path as the working directory for these commands.

**Text message:**

```bash
cd "<path from system prompt: The code you're running on is at: ...>" && greg telegram send "Your message here"
```

**Voice message (ElevenLabs TTS):**  
Add `--voice`. If `config.voice.elevenlabs` is not set in `~/.greg/config.ts` or the voice API errors, send the message as normal text instead using `greg telegram send` without the `--voice` flag.

```bash
cd [WORKSPACE_ROOT] && greg telegram send --voice "Your message here"
```

When sending a message:

- Keep it **short and readable**.
- Prefer a quick summary plus a pointer (path, ID, etc.) instead of dumping full raw data.
- **Do not also return or echo that message in your reply to the user.** If you used `greg telegram send`, the message was already delivered to Telegram; your chat response should not repeat the same text.

## Preserving Whitespace and Line Breaks

Passing a multi-line message directly as a shell argument will collapse all newlines. Use bash ANSI-C quoting (`$'...'`) with `\n` to preserve line breaks — no temp file needed:

```bash
cd [WORKSPACE_ROOT] && greg telegram send $'Line 1\n\nLine 2\n- item 1\n- item 2'
```

For very long messages, you can also write to a temp file and use `$(cat ...)`:

```bash
printf 'Line 1\n\nLine 2\n- item\n' > /tmp/message.txt
cd [WORKSPACE_ROOT] && greg telegram send "$(cat /tmp/message.txt)"
```

Formatting guidelines:

- Use blank lines to separate sections.
- Use `-` for bullet lists and short items.
- Use fenced code blocks only for short snippets or logs, not for huge outputs.

## When to Use

- Sending notifications or alerts
- Confirming completed tasks
- Providing updates on long-running processes
- Emergency notifications
- Quick status updates
- Asking the user a question and using their reply (handled internally by the agent when e.g. confirming guarded commands)

For long-running processes:

- Send a brief **"started"** message if the task may take a long time.
- Send a **"finished"** message with a 1–3 line summary and where to find detailed results.

## Technical Details

- Command: `greg telegram send <message>` with optional `--voice` and `--await-reply`.
- Arguments: `message` — the text to send.
- **Do not echo the message in your reply.** After running `greg telegram send`, the user receives it in Telegram. In the chat, confirm briefly (e.g. "Sent to Telegram") or move on; do not paste or repeat the message content.
- `--voice`: send as a voice message (ElevenLabs). Falls back to text if `config.voice.elevenlabs.key` / `config.voice.elevenlabs.voiceId` are missing or the API fails. When you use `--voice`, do **not** add meta-comments like "(Replied via voice!)" or "I sent you a voice message".
- The Telegram client is already configured and ready to use.

## Notes

- Always derive the workspace root from the system prompt; do not assume a fixed path.
- Run the command from the workspace root (where package.json lives).
- Messages should be wrapped in quotes to handle spaces and special characters.
- The connection is already set up, no additional configuration needed.
- For voice: configure `voice.elevenlabs.key` and `voice.elevenlabs.voiceId` in `~/.greg/config.ts` to enable voice. If not set, `--voice` still sends the message as text.

If the command fails (e.g. `bun` error, script not found, Telegram not configured):

- Show the error message to the user.
- Explain that the Telegram notification could not be delivered.
- Suggest running the command manually in a terminal to debug environment issues.
