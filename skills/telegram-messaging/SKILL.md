---
name: telegram-messaging
description: 'How to send messages to the user via Telegram using greg telegram send'
---

# Telegram Messaging

## Overview

This workspace has a built-in Telegram messaging capability. Use the `greg telegram send` command to send messages to the user and optionally wait for a reply.

## When to use this skill

Use Telegram messaging when:

- You want to send **short notifications or alerts** about job status, errors, or important events.
- You need to send the user a **concise summary** of results from a long-running process.
- The user explicitly asks to **receive updates via Telegram**.
- You need to **ask the user a question** and use their reply in the next step (use `--await-reply`).

Avoid using this skill for:

- Extremely long logs or outputs that will be unreadable in a messaging app.
- Highly sensitive data that should not leave the local environment (unless the user explicitly insists).

## How to Send Messages

Run from the workspace root. **Get the workspace path from your system prompt** (look for "The code you're running on is at:"). If that path is the repo root, use it as-is; if it points to a subfolder (e.g. the agent directory), use its parent as the workspace root.

**Send only (fire-and-forget):**

```bash
cd [WORKSPACE_ROOT] && bun run greg telegram send "Your message here"
```

**Send and wait for a reply:**

Use `--await-reply` when you need the user’s answer (e.g. a confirmation or a choice). When stdout is not a TTY, only the reply text is printed, so you can capture it easily.

```bash
cd [WORKSPACE_ROOT] && bun run greg telegram send --await-reply "Your question here"
```

When sending a message:

- Keep it **short and readable**.
- Prefer a quick summary plus a pointer (path, ID, etc.) instead of dumping full raw data.

## Preserving Whitespace and Line Breaks

Passing a multi-line message directly as a shell argument will collapse all newlines. Use bash ANSI-C quoting (`$'...'`) with `\n` to preserve line breaks — no temp file needed:

```bash
cd [WORKSPACE_ROOT] && bun run greg telegram send $'Line 1\n\nLine 2\n- item 1\n- item 2'
```

For very long messages, you can also write to a temp file and use `$(cat ...)`:

```bash
printf 'Line 1\n\nLine 2\n- item\n' > /tmp/message.txt
cd [WORKSPACE_ROOT] && bun run greg telegram send "$(cat /tmp/message.txt)"
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
- Asking the user a question and using their reply (with `--await-reply`)

For long-running processes:

- Send a brief **"started"** message if the task may take a long time.
- Send a **"finished"** message with a 1–3 line summary and where to find detailed results.

## Technical Details

- Command: `bun run greg telegram send [options] <message>`
- Arguments: `message` — the text to send.
- Options:
  - `--await-reply` — wait for a reply, then exit. When stdout is not a TTY, only the reply is printed (for easy capture).
- The Telegram client is already configured and ready to use.

## Notes

- Always derive the workspace root from the system prompt; do not assume a fixed path.
- Run the command from the workspace root (where package.json lives).
- Messages should be wrapped in quotes to handle spaces and special characters.
- The connection is already set up, no additional configuration needed.

If the command fails (e.g. `bun` error, script not found, Telegram not configured):

- Show the error message to the user.
- Explain that the Telegram notification could not be delivered.
- Suggest running the command manually in a terminal to debug environment issues.
