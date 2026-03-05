---
name: telegram-messaging
description: 'How to send messages to the user via Telegram using the built-in script'
---

# Telegram Messaging

## Overview

This workspace has a built-in Telegram messaging capability that allows sending messages directly to the user via Telegram.

## When to use this skill

Use Telegram messaging when:

- You want to send **short notifications or alerts** about job status, errors, or important events.
- You need to send the user a **concise summary** of results from a long-running process.
- The user explicitly asks to **receive updates via Telegram**.

Avoid using this skill for:

- Extremely long logs or outputs that will be unreadable in a messaging app.
- Highly sensitive data that should not leave the local environment (unless the user explicitly insists).

## How to Send Messages

Use the terminal command with the predefined npm script. **Get the workspace path from your system prompt** (look for "The code you're running on is at:"). If that path is the repo root, use it as-is; if it points to a subfolder (e.g. the agent directory), use its parent as the workspace root.

```bash
cd [WORKSPACE_ROOT] && bun run clients:telegram:send-message "Your message here"
```

When you send a message:

- Keep it **short and readable**.
- Prefer a quick summary plus a pointer (path, ID, etc.) instead of dumping full raw data.

## Preserving Whitespace and Line Breaks

Passing a multi-line message directly as a shell argument will collapse all newlines. Use bash ANSI-C quoting (`$'...'`) with `\n` to preserve line breaks — no temp file needed:

```bash
cd [CODE_ROOT] && bun run clients:telegram:send-message $'Line 1\n\nLine 2\n- item 1\n- item 2'
```

For very long messages, you can also write to a temp file and use `$(cat ...)`:

```bash
printf 'Line 1\n\nLine 2\n- item\n' > /tmp/message.txt
cd [CODE_ROOT] && bun run clients:telegram:send-message "$(cat /tmp/message.txt)"
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

For long-running processes:

- Send a brief **"started"** message if the task may take a long time.
- Send a **"finished"** message with a 1–3 line summary and where to find detailed results.

## Technical Details

- The script is defined in package.json as `"clients:telegram:send-message": "bun run clients/telegram/send-message.ts"`
- It accepts a message string as an argument
- Returns "Sent [message]" on success
- The Telegram client is already configured and ready to use

## Notes

- Always derive the workspace root from the system prompt; do not assume a fixed path
- Run the command from the workspace root (where package.json lives)
- Messages should be wrapped in quotes to handle spaces and special characters
- The connection is already set up, no additional configuration needed

If the command fails (e.g. `bun` error, script not found, Telegram not configured):

- Show the error message to the user.
- Explain that the Telegram notification could not be delivered.
- Suggest running the command manually in a terminal to debug environment issues.
