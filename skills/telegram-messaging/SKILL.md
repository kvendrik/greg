---
name: telegram-messaging
description: "How to send messages to the user via Telegram using the built-in script"
---

# Telegram Messaging

## Overview
This workspace has a built-in Telegram messaging capability that allows sending messages directly to the user via Telegram.

## How to Send Messages

Use the terminal command with the predefined npm script. **Get the workspace path from your system prompt** (look for "The code you're running on is at:"). If that path is the repo root, use it as-is; if it points to a subfolder (e.g. the agent directory), use its parent as the workspace root.

```bash
cd [WORKSPACE_ROOT] && bun run clients:telegram:send-message "Your message here"
```

## Example Usage

```bash
cd /path/from/system/prompt && bun run clients:telegram:send-message "Test message! 👋"
```

(Replace `/path/from/system/prompt` with the actual workspace root you derived from the system prompt.)

## When to Use

- Sending notifications or alerts
- Confirming completed tasks
- Providing updates on long-running processes
- Emergency notifications
- Quick status updates

## Technical Details

- The script is defined in package.json as `"clients:telegram:send-message": "bun run clients/scripts/send-telegram-message.ts"`
- It accepts a message string as an argument
- Returns "Sent [message]" on success
- The Telegram client is already configured and ready to use

## Notes

- Always derive the workspace root from the system prompt; do not assume a fixed path
- Run the command from the workspace root (where package.json lives)
- Messages should be wrapped in quotes to handle spaces and special characters
- The connection is already set up, no additional configuration needed