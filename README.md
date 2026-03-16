# 🤖 Greg

An [OpenClaw](https://openclaw.ai/)-like personal assistant but with _way_ less lines of code and therefore easier to understand, customize, and be used with confidence.

## Features

- 🧠 **Memory**. Greg remembers facts you tell him about yourself as well as conversation notes to Markdown files in your workspace.
- 🌍 **Web Search & Fetching**. Greg is capable of searching the web using Google Search Grounding. He can then also fetch websites automatically to answer questions.
- 🌍 **Browser Automation**. When a simple fetch isn't enough, Greg is also capable of controlling your Chrome browser and can therefore do anything online you can do.
- 👨‍💻 **Command-line Access**. Greg has access to your command line and can therefore do most of the things you do on your computer.
- 🔨 **Skills**. Greg learns on his own. If he has trouble figuring something out, help him, and then simply say "What have you learned? Write a skill for yourself so you know this next time". He'll create a skill for himself so that in the future he won't struggle.
- 💾 **Session Persistence**. Greg persists sessions as JSONL files in your workspace. This way he won't lose context between restarts.
- 📦 **Auto-Compaction**. When a session reaches 80% of its maximum context window Greg summarizes it and compacts his context. This ensures you can keep talking forever.
- 🚏 **Supports Most Popular Models**. Greg uses [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) and therefore supports most popular models. He ships with a fallback system that allows you to configure what model should be used in case your preferred model isn't available. You can also define additional models and invoke them for whatever prompt you want using `/` commands.
- ❤️ **Heartbeat**. Greg comes with an OpenClaw-style heartbeat. Every X minutes he goes over a `HEARTBEAT.md` file and can send you updates. (`off` by default)
- 💂 **Exec Guarding**. If Greg tries to run command line commands that you've not approved a separate system will ask for your permission first. (`off` by default)
- 🗣️ **Voice Messages**. Greg ships with a Telegram integration that is capable of sending voice messages by transcribing his responses using [ElevenLabs](https://elevenlabs.io/). This does require a ElevenLabs API key. See ["Voice Messages"](️#🗣️-voice-messages) below for more info.
- 📞 **Voice Calls**. Greg ships with [tools](hub/voicecall) that allow him to place voice calls using [ElevenLabs](https://elevenlabs.io/) and [Twilio](https://www.twilio.com). Running `greg doctor` will help you understand what environment variables are needed to make this work.

Oh and you don't have to call him Greg. Just say "From now on your name is John" and that's it.

## Setup

1. Clone this repository and `cd` into it

```bash
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
      key: '...', // https://console.anthropic.com/settings/keys
    },
    {
      role: 'fallback',
      // /command to use to ask Greg to use this model for a given prompt
      // e.g. "/openai How’s the weather today?" will use this model over Sonnet
      command: 'openai',
      model: getModel('openai', 'gpt-5.2'),
      key: '...', // https://platform.openai.com/api-keys
    },
  ],
  tools: {
    webSearch: {
      // Defining this enables the web_search tool. Optional, but recommended.
      // Uses Gemini for Google Search Grounding. Alternatively use provider: 'brave'.
      // https://cloud.google.com/gemini-api/docs/get-started
      provider: 'gemini',
      key: '...',
    },
    browser: {
      // Enables the browser automation tool using Browser Use and their blazingly
      // fast finetuned model. Optional, but recommended.
      // https://cloud.browser-use.com/settings?tab=api-keys&new=1
      key: '...',
    },
    guard: {
      // Enable the Guard so only Greg won't run commands you haven't approved.
      // `false` by default.
      // Keep in mind that some commands are allowed by default.
      // Find them in `default_exec_allowlist.ts`
      enabled: true,
    },
  },
  heartbeat: {
    // Enable the heartbeat. `false` by default
    enabled: true,
    // every 30 minutes Greg will read ~/.greg/HEARTBEAT.md for things to do
    interval: 30,
  },
};

export default config;
```

(See the [`Config type`](config/types.ts) for all config options.)

3. Then pick how you want to interact with Greg!

The default way of interacting with Greg is through Telegram (see "Custom clients" below for other options). In the config set:

```ts
const config = {
  ...
  clients: {
    telegram: {
      /**
       * https://core.telegram.org/bots#how-do-i-create-a-bot
       */
      botToken: '...',
      /**
       * Your user ID (e.g. from [@userinfobot](https://t.me/userinfobot)).
       */
      senderId: '...',
    };
  };
  ...
};
```

4. Then run the setup and start commands:

```bash
uv sync

bun install
bun link

# Checks if all dependencies are there.
# Warns for optional dependencies that aren’t there.
greg doctor

# Start the gateway
greg gateway start
```

You should see logs that indicate that both the gateway and the Telegram service are ready! 🎉

## Custom clients

If you would like to use something else than Telegram you have to create a client yourself. To do this, create a script like the default [`scripts/start.ts`](scripts/start.ts) script.

Here's an example:

```ts
// scripts/custom-start.ts

import * as gateway from '../gateway';

const { stop } = await gateway.start();

// This gets the main session, which the gateway loads
// by default on startup. It's also possible to load and prompt
// a new session through: `await gateway.load('my-new-session')`.
const session = gateway.get('main');

session.subscribe('my-custom-channel', {
  onTurnStart: () => {},
  onThinking: (chunk) => process.stdout.write(chunk),
  onContent: (chunk) => process.stdout.write(chunk),
  onToolcall: async (name, args) => console.log(JSON.stringify({ name, args })),
  onTurnDone: async () => {},
  onTurnStop: async () => {},
  onError: async (error: string) => {},
});

await session.prompt('Hey Greg!', {
  // can also be set to `all` to broadcast a result
  // to all channels subscribed to the session
  channelId: 'my-custom-channel',
});

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  stop();
  process.exit(0);
}
```

You can call `bun run scripts/custom-start.ts` directly, but I'd recommend updating the `gateway` script in the `package.json` so that you can use `greg start` to start your custom integration.

## 🔨 Skills

Greg can be taught how to do anything by simply telling him to read an [AgentSkill](https://agentskills.io) and to save it for later use. Doing so will cause Greg to save a new skill to your workspace.

## 📦 Hub

Greg also ships with a couple of CLI's that I couldn't find good versions of elsewhere. These are available through the `greg hub` command.

Greg already knows how to use them as all `hub/*/AGENT.md` files are loaded as skills by default. `greg doctor` will warn you if any of the CLIs doesn't have its dependencies installed. Greg might try to use one of the CLI's, discover he can’t because he's missing dependencies, and ask you about it.

## ❤️ Heartbeat

Greg comes with an OpenClaw-style heartbeat that allows you to have Greg initiate conversation with you. If enabled (it's disabled by default), Greg will go over instructions in a `HEARTBEAT.md` file in your workspace every X minutes.

```ts
const config = {
  ...
  heartbeat: {
    // Enable the heartbeat. `false` by default
    enabled: true,
    // every 30 minutes Greg will read ~/.greg/HEARTBEAT.md for things to do
    interval: 30,
  },
  ...
};
```

By default he prompts the `main` session and doesn't send the results anywhere. Make sure to tell him what to do with anything he might want to tell you in his `HEARTBEAT.md` file:

```md
# Heartbeat check

Send me a quick check-in on Telegram through `greg telegram send --message`.
```

The Telegram integration also connects to the `main` session by default. The heartbeat and the integration running within the same session ensures that Greg will understand what you're talking about if you respond to something he said because of a heartbeat.

## 💂 Guard

Greg also comes with a guard (disabled by default). Whenever Greg tries to run a command line command (his `exec()` tool) the guard checks if the command is allowed by either the list of commands that are allowed by default (`agent/tools/utilities/policy/default_exec_allowlist.ts`) or your workspace’s allowlist (`[config.workspace]/exec_allowlist.json`).

If the command is not in either list the guard will send you a message to ask for permission. Greg will wait for you to confirm or decline before he can continue answering your prompt.

If you're using Telegram the Guard's messages will be delivered there. If you're using a custom client you need to configure this yourself through the `setGetReply()` callback:

```ts
...
const { setGetReply, stop } = await gateway.start();

setGetReply(async (question) => {
  // send message to user and return reply
  return getUserReplyFromSomeWhere(question);
});
...
```

## 🗣️ Voice Messages

Greg can send you voice messages through his Telegram integration:

```bash
greg telegram send "Hey! How are you?" --voice
```

For this to work you do need to set a [ElevenLabs](https://elevenlabs.io/) API key and voice ID in your config:

```ts
const config = {
  ...
  voice: {
    elevenlabs: {
      key: '...',
      voiceId: '...',
    },
  },
  clients: {
    telegram: {
      /**
       * https://core.telegram.org/bots#how-do-i-create-a-bot
       */
      botToken: '...',
      /**
       * Your user ID (e.g. from [@userinfobot](https://t.me/userinfobot)).
       */
      senderId: '...',
    };
  };
  ...
};
```
