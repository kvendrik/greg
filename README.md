# Greg

An [OpenClaw](https://openclaw.ai/)-like personal assistant but with _way_ less lines of code and therefor easier to understand, customize, and be used with confidence.

## Features

- 🧠 **Memory**. Greg remembers facts you tell him about yourself as well as conversation notes to Markdown files in your workspace
- 🌍 **Browser Automation**. Greg is capable of controlling your Chrome browser autonomously and can therefor do anything online you can do.
- 👨‍💻 **Command-line Access**. Greg has access to your command line and can therefor do most of the things you do on your computer.
- 🔨 **Skills**. Greg learns on his own. If he has trouble figuring something out, help him, and then simply say "What have you learned? Write a skill for yourself so you know this next time". He'll create a skill for himself so that in the future he won't struggle.
- 🚏 **Supports Multiple Providers**. By default Greg uses [Claude Sonnet 4.6](https://platform.claude.com/docs/en/about-claude/models/overview) but when the Anthropic API is overloaded he switches to using [GPT 5.2](https://developers.openai.com/api/docs/models). You can also manually ask Greg to use GPT 5.2 by prefixing your message with `/openai`.
- 🗣️ **Threads**. Talk to Greg in multiple threads at the same time.
- **Soon:**
  - 📆 **Scheduled Tasks**. Schedule reocurring tasks by saying things like "Every morning at 6am send me a list of my unread emails".
  - 💗 **Heartbeat**. Every 30 minutes Greg will check his `HEARTBEAT.md` file for things to do.

Oh and you don't have to call him Greg. Just say "From now on your name is John" and that's it.

## Setup

1. Clone this repository and `cd` into it

```

```

2. Set up the config file (`.config.ts` in the cloned folder) with access to the services Greg needs:

```ts
// .config.ts

import { Config, validate } from './config';
import { getModel } from '@mariozechner/pi-ai';

const config: Config = {
  workspace: '~/.greg',
  port: '3000',
  models: [
    {
      role: 'primary',
      model: getModel('anthropic', 'claude-sonnet-4-6'),
      key: 'XXX', // https://console.anthropic.com/settings/keys
    },
    {
      role: 'fallback',
      command: 'openai',
      model: getModel('openai', 'gpt-5.2'),
      key: 'XXX', // https://platform.openai.com/api-keys
    },
  ],
  tools: {
    browser: {
      key: 'XXX', // https://cloud.browser-use.com/settings?tab=api-keys&new=1
    },
  },
};

validate(config);
export default config;
```

3. Then run the setup commands:

```
bun install
bun link
greg start
```

4. Then pick how you want to interact with Greg! Easiest way is to use the CLI:

```
greg cli
```

When used to the agent you can start using Telegram to communicate. Running
the `greg telegram` command will tell you how to set it up.
