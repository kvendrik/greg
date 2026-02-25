- [ ] When using tools with Claude the second message leads to a `400` error
- [ ] It should send periodic updates during long tasks like the browser. Every paragraph should be send to the telegram bot so that if you use it there the updates work
- [ ] Using Haiku for the greetings is fast but its also way less fun. What to do about that?

---

# Greg

An [OpenClaw](https://openclaw.ai/)-like personal assistant but with _way_ less lines of code and therefor easier to understand, customize, and be used with confidence.

## Features

- 🧠 **Memory**. Greg remembers facts you tell him about yourself as well as conversation notes to Markdown files in your workspace
- 🌍 **Browser Automation**. Greg is capable of controlling your Chrome browser autonomously and can therefor do anything online you can do.
- 👨‍💻 **Command-line Access**. Greg has access to your command line and can therefor do most of the things you do on your computer.
- 🔨 **Skills**. Greg learns on his own. If he has trouble figuring something out, help him, and then simply say "What have you learned? Write a skill for yourself so you know this next time". He'll create a skill for himself so that in the future he won't struggle.
- 🚏 **Routing**. When you send Greg a prompt he first takes a second to decide what model he's going to use. Greg currently only works with [Claude models](https://platform.claude.com/docs/en/about-claude/models/overview).
- 🗣️ **Threads**. Talk to Greg in multiple threads at the same time.
- **Soon:**
  - 📆 **Scheduled Tasks**. Schedule reocurring tasks by saying things like "Every morning at 6am send me a list of my unread emails".
  - 💗 **Heartbeat**. Every 30 minutes Greg will check his `HEARTBEAT.md` file for things to do.

Oh and you don't have to call him Greg. Just say "From now on your name is John" and that's it.

## Setup

1. Clone this repository and `cd` into it

```

```

2. Set up the `.env` file with access to the services Greg needs:

```
ANTHROPIC_API_KEY=XXX
BROWSER_USE_API_KEY=XXX

WORKSPACE_PATH=~/.greg
AGENT_PORT=3000
```

3. Then run the setup commands:

```
bun install
bun link
greg start
```

4. Then pick how you want to interact with Greg!

```
# Then pick how to interact with Greg. Easiest to get started is the CLI:
greg cli

# when used to the agent you can start using Telegram to communicate.
# running the `telegram` command will tell you how to set it up.
greg telegram
```

## Workspace

`WORKSPACE_PATH` holds all of your memory files. They’re all plain Markdown so you can edit them directly. If you do just make sure to run `greg index` to ensure Greg's vector store is updated with the changes.
