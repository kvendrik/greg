- [ ] Add CLIs for WhatsApp, Telegram, and iMessage to include messaging in morning updates
- [ ] Give Greg a way to make calls

---

# 🤖 Greg

An [OpenClaw](https://openclaw.ai/)-like personal assistant but with _way_ less lines of code and therefore easier to understand, customize, and be used with confidence.

## Features

- 🧠 **Memory**. Greg remembers facts you tell him about yourself as well as conversation notes to Markdown files in your workspace.
- 🌍 **Web Search & Fetching**. Greg is capable of searching the web using Google Search Grounding. He can then also fetch websites automatically to answer questions.
- 🌍 **Browser Automation**. When a simple fetch isn't enough, Greg is also capable of controlling your Chrome browser and can therefore do anything online you can do.
- 👨‍💻 **Command-line Access**. Greg has access to your command line and can therefore do most of the things you do on your computer.
- 🔨 **Skills**. Greg learns on his own. If he has trouble figuring something out, help him, and then simply say "What have you learned? Write a skill for yourself so you know this next time". He'll create a skill for himself so that in the future he won't struggle.
- 🚏 **Supports Most Popular Models**. Greg uses [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) and therefore supports most popular models. He ships with a fallback system that allows you to configure what model should be used in case your preferred model isn't available. You can also define additional models and invoke them for whatever prompt you want using `/` commands.
- 🗣️ **Threads**. Talk to Greg in multiple threads at the same time.
- 📆 **Scheduled Tasks**. Schedule recurring tasks by saying things like "Every morning at 6am send me a list of my unread emails".

Oh and you don't have to call him Greg. Just say "From now on your name is John" and that's it.

## Setup

1. Clone this repository and `cd` into it

```
git clone git@github.com:kvendrik/greg.git
```

2. Set up the config file (`.greg.ts` in the cloned folder) with access to the services Greg needs:

```ts
// .greg.ts

import { Config, validate } from './config';
import { getModel } from '@mariozechner/pi-ai';

const config: Config = {
  id: 'greg',
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
      // /command to use to ask Greg to use this model for a given prompt
      // e.g. "/openai How’s the weather today?" will use this model over Sonnet
      command: 'openai',
      model: getModel('openai', 'gpt-5.2'),
      key: 'XXX', // https://platform.openai.com/api-keys
    },
  ],
  tools: {
    webSearch: {
      // Defining this enables the web_search tool. Optional, but recommended.
      // Uses Gemini to use Google Search Grounding and therefore requires a key
      // https://cloud.google.com/gemini-api/docs/get-started
      geminiKey: 'XXX',
    },
    browser: {
      // Enables the browser automation tool using Browser Use and their blazingly
      // fast finetuned model. Optional, but recommended.
      // https://cloud.browser-use.com/settings?tab=api-keys&new=1
      key: 'XXX',
    },
  },
};

export default config;
```

(See the [`Config type`](/config/types.ts)) for all config options)

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

## Skills

Greg can be taught how to do anything by simply telling him to read an AgentSkill and to save it for later use. Doing so will cause Greg to save a new skill to your workspace

Greg also ships with a couple of CLI's that I couldn't find good versions of elsewhere. These are available in `/hub`. Greg already knows how to use them but they require auth tokens. When Greg tries to use them at the start he'll come back to you saying he needs access.

## Scheduled Jobs

Greg comes with the ability to schedule jobs. You can do this directly from the CLI or by simply talking to Greg.

```
greg jobs add "Every day at 6am send me a list of my unread emails"
```

These jobs only work however if you keep an instance of the scheduler running: `greg jobs schedule`. The scheduler prompts Greg at the given time in a new thread so that it doesn't conflict with whatever other work Greg might be doing at that time.
