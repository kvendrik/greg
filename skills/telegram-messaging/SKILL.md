---
name: telegram-messaging
description: "How to send messages to the user via Telegram using the built-in script"
---

# Telegram Messaging

## Overview
The PA Agent has a built-in Telegram messaging capability that allows sending messages directly to the user via Telegram.

## How to Send Messages

Use the terminal command with the predefined npm script:

```bash
cd [PA_AGENT_ROOT] && bun run clients:telegram:send-message "Your message here"
```

Where `[PA_AGENT_ROOT]` is the base directory of the pa-agent project.

## Finding the Correct Path

Check your system prompt for "The code you're running on is at:" - the pa-agent root directory is the parent of that path. 

For example, if the system prompt says the code is at `/Users/koenvendrik/pa-agent/agent`, then the root is `/Users/koenvendrik/pa-agent`.

## Example Usage

```bash
cd /Users/koenvendrik/pa-agent && bun run clients:telegram:send-message "Test message from Greg! 👋"
```

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

- Always check the system prompt for the current pa-agent path
- Make sure to run from the pa-agent root directory (parent of the agent folder)
- Messages should be wrapped in quotes to handle spaces and special characters
- The connection is already set up, no additional configuration needed