# 🤖 Greg

An [OpenClaw](https://openclaw.ai/)-like personal assistant but with _way_ fewer lines of code (`~15k` vs `~450k`) and therefore easier to understand, customize, and be used with confidence.

## Features

- 🧠 **Memory**. Greg remembers facts you tell him about yourself as well as conversation notes to Markdown files in your workspace.
- 🌍 **Web Search & Fetching**. Greg is capable of searching the web using Google Search Grounding. He can then also fetch websites automatically to answer questions.
- 🌍 **Browser Automation**. When a simple fetch isn't enough, Greg is also capable of controlling your Chrome browser and can therefore do anything online you can do.
- 👨‍💻 **Command-line Access**. Greg has access to your command line and can therefore do most of the things you do on your computer.
- 🔨 **Skills**. Greg learns on his own. If he has trouble figuring something out, help him, and then simply say "What have you learned? Write a skill for yourself so you know this next time". He'll create a skill for himself so that in the future he won't struggle.
- 💾 **Session Persistence**. Greg persists sessions as JSONL files in your workspace. This way he won't lose context between restarts.
- 📦 **Auto-Compaction**. When a session reaches 80% of its maximum context window Greg summarizes it and compacts his context. This ensures you can keep talking forever.
- ❤️ **Heartbeat**. Greg comes with an OpenClaw-style heartbeat. Every X minutes he goes over a `HEARTBEAT.md` file and can send you updates. (`off` by default)
- 🤖🤖🤖 **Subagents**. Greg can spawn subagents who complete tasks in the background. Subagents can use different models, system prompts, and access than Greg.
- 🚏 **Supports Most Popular Models**. Greg uses [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) and therefore supports most popular models. He ships with a fallback system that allows you to configure what model should be used in case your preferred model isn't available. You can also define additional models and invoke them for whatever prompt you want using `/` commands.
- 💂 **Guarding**. If Greg tries to run tools or commands that you've not pre-approved a separate system will ask for your permission first.
- 🗣️ **Voice Messages**. Greg ships with a Telegram integration that is capable of sending voice messages by transcribing his responses using [ElevenLabs](https://elevenlabs.io/). This does require a ElevenLabs API key. See "Voice Messages" below for more info.

Oh and you don't have to call him Greg. Just say "From now on your name is John" and that's it.

## Setup

1. Clone this repository, install the dependencies, and `link` so you have access to the CLI

```bash
git clone git@github.com:kvendrik/greg.git ~/greg
cd ~/greg

bun install
bun link
```

2. Set up the config file in `~/.greg/config.ts`

```ts
import { type Config, exec, getModel } from '../greg/config';

const config: Config = {
  models: [
    {
      role: 'primary',
      model: getModel('anthropic', 'claude-sonnet-4-6'),
      key: '...', // https://platform.claude.com
    },
    /**
     * Optional:
     * A model to fall back to when the primary model is unavailable
     */
    {
      role: 'fallback',
      model: getModel('openai', 'gpt-5.4'),
      key: '...', // https://platform.openai.com/
      /**
       * Optional:
       * Command to trigger usage of this model manually.
       * e.g. "/openai Hey Greg!" will use this model instead of the primary model
       */
      command: 'openai',
    },
    /**
     * Optional:
     * Any number of additional models you can invoke manually and use in subagents
     */
    {
      model: getModel('google', 'gemini-3-flash-preview'),
      key: '...', // https://aistudio.google.com/
      command: 'gemini',
    },
  ],
  tools: {
    /**
     * Optional:
     * Web search using either Brave or Google Gemini (uses Search Grounding)
     */
    webSearch: {
      provider: 'brave',
      key: '...', // https://brave.com/search/api/
    },
    /**
     * Optional:
     * Browser automation using Browser Use v2 and their finetuned model
     */
    browser: {
      key: '...', // https://browser-use.com/
    },
    /**
     * Optional:
     * Blocks risky tool calls (all `exec` functionality, file writes, and web fetching)
     * by default and will ask you for permission to run them (when `ask` is enabled).
     */
    guard: {
      /**
       * Disabling the Guard (YOLO-mode) lets Greg do whatever he wants without requiring permission.
       */
      enabled: true,
      /**
       * By setting this to `true` Greg will use whatever client you’re using to ask for
       * permission when his settings don't allow him to run a certain tool call. Setting it
       * to `false` will deny Greg to run the tool call without asking.
       */
      ask: true,
      /**
       * Optional:
       * A list of exec calls to always allow. This example config
       * uses pre-defined defaults from config/exec-defaults.ts
       */
      exec: {
        profiles: exec.profiles,
        allowBins: exec.merge<typeof exec.profiles>(
          exec.readOnly,
          exec.safeWrite
        ),
      },
      /**
       * Optional:
       * Define what root paths Greg can read and write to.
       * ~/.greg and /tmp/greg are allowed by default.
       */
      files: {
        read: ['~/path/to/code'],
        write: ['~/path/to/code', '!~/path/to/code/but/not/this/folder'],
      },
    },
    /**
     * Optional:
     * Deny the usage of certain tools (browser automation in this case).
     * You can also use `tools.allow` to specify the only tools Greg is allowed to use.
     */
    deny: ['browser_use'],
  },
  /**
   * Optional:
   * Use the heartbeat. Greg will read ~/.greg/workspace/HEARTBEAT.md
   * every X minutes to check for things to do.
   */
  heartbeat: {
    enabled: true,
    interval: 30,
  },
  /**
   * Optional:
   * Use voice functionality
   * Features: voice messages and voice mode in the TUI.
   */
  voice: {
    elevenlabs: {
      key: '...', // https://elevenlabs.io/app/api/api-keys
      voiceId: '...', // https://elevenlabs.io/app/api/voice-library
    },
  },
  /**
   * Optional:
   * Use communication through Telegram
   * Other options are the TUI or a custom client (see below)
   */
  telegram: {
    botToken: '...', // https://core.telegram.org/api
    senderId: '...', // curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
  },
};

export default config;
```

4. Make sure your config is working correctly by running the doctor:

```bash
# Checks if all dependencies are there.
# Warns for optional dependencies that aren’t there.
greg doctor
```

5. If all is good start the gateway!

```bash
greg gateway start
```

You should see logs that indicate that both the gateway and the Telegram service are ready! 🎉 If you're not using Telegram you can try out the TUI by running `greg tui`.

## 🔨 Skills

Greg can be taught how to do anything by simply telling him to read an [AgentSkill](https://agentskills.io) and to save it for later use. Doing so will cause Greg to save a new skill to his workspace.

## ❤️ Heartbeat

Greg comes with an OpenClaw-style heartbeat that allows you to have Greg initiate conversation with you. If enabled (it's disabled by default), Greg will go over instructions in a `HEARTBEAT.md` file in your workspace every X minutes.

```ts
const config = {
  ...
  heartbeat: {
    // Enable the heartbeat. `false` by default
    enabled: true,
    // every 30 minutes Greg will read ~/.greg/workspace/HEARTBEAT.md for things to do
    interval: 30,
  },
  ...
};
```

By default he prompts the `main` session and doesn't send the results anywhere. Make sure to tell him what to do with anything he might want to tell you in his `HEARTBEAT.md` file:

```md
# Heartbeat check

Send me a quick check-in on Telegram through `greg telegram send <message>`.
```

The Telegram integration also connects to the `main` session by default. The heartbeat and the integration running within the same session ensures that Greg will understand what you're talking about if you respond to something he said because of a heartbeat.

## 🤖🤖🤖 Subagents

Greg is capable of spawning as many subagents as you'd like. Subagents run in the background and communicate with Greg directly. Greg then communicates with you.

Subagents have their own workspace with persistent session storage, their own system prompt, and can use any of the models you have configured in your config. Based on what the subagent is for Greg will decide what tools the subagent needs access to. If the subagent has access to `exec` tools and the Guard is on (see "Guard" section below) they will ask for permission in the same way Greg does.

Spawning subagents allows you to do some fun things. I've used it to spawn agents for specialized tasks like doing research, to give me my morning update (it takes a while to fetch and compose all the data), or to debate topics by spawning a [council of agents](skills/agent-council/SKILL.md).

To try it out just ask Greg to spawn a new agent to for example do research online. Greg will create a new agent for the task you've laid out and give them a human-like name. When you're done the agent data will persist and you can ask Greg at any time to talk to the agent to pick up a new task.

## 🗣️ Voice Messages

Greg can send you voice messages through his Telegram integration:

```bash
greg telegram send "Hey! How are you?" --voice
```

For this to work you do need to set a [ElevenLabs](https://elevenlabs.io/) API key and voice ID in your config. We use ElevenLabs v3 for this. Greg has a voice messaging skill that tells him how to use [Audio Tags](https://elevenlabs.io/blog/v3-audiotags). It produces some of the best computer-generated audio I've heard.

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

## 📦 Hub

Greg ships with a couple of CLI's that I couldn't find good versions of elsewhere. These are available through the `greg hub` command.

He already knows how to use them as all `hub/*/AGENT.md` files are loaded as skills by default. `greg doctor` will warn you if any of the CLIs doesn't have its dependencies installed. Greg might try to use one of the CLI's, discover he can’t because he's missing dependencies, and ask you about it.

CLI's in the Hub:

- `greg hub notion` provides a read-only CLI for Notion for Greg to use
- `greg hub strava` provides a read-only CLI for Strava for Greg to use

Greg also works well with the [📞 `voicecall` CLI](https://github.com/kvendrik/voicecall) to make voice calls. Just point him at the [`AGENT.md` file](https://github.com/kvendrik/voicecall/blob/main/AGENT.md) to use it.

## 💂 Guard

Greg comes with a guard that’s enabled by default. You can turn it off by setting `tools.guard.enabled` to `false` if you want to go YOLO-mode.

When enabled, the first thing it does is run all `exec` calls inside a sandbox. The sandbox only allows file reads and networking, nothing else. This ensures the LLM always uses the dedicated file tools to modify files. Those tools ensure file writes are only allowed inside Greg's workspace and the `/tmp` folder.

It will also block any risky tool call (exec, any file writes, and web fetch). When it does it will ask you for permission to run the tool call on Telegram or through the TUI (depending on if you started through `greg tui` or `greg gateway start`):

````md
💂 Greg is asking to run a tool:

```js
execve({
  command: '/opt/homebrew/bin/gog',
  args: ['gmail', 'messages', 'search', '--max', '20'],
  background: false,
});
```

/deny <reason> - deny to run this command, optionally provide a reason
/once - allow to run this command this time
/10m - allow all `execve` calls for the next 10 minutes
````

You can use `tools.guard.exec` to allow more commands:

```ts
const config: Config = {
  ...
  guard: {
      ...
      exec: {
        profiles: {
          // will allow `git log --oneline -n 200`
          git_log: {
            allowSubcommands: [
              ['log'],
            ],
            allowFlags: {
              '--oneline': { takesValue: false },
              '-n': {
                takesValue: true,
                value: { type: 'int', min: 1, max: 200 },
              },
            },
          },
        },
        allowBins: {
          '/usr/bin/git': { profiles: ['git_log'] },
        },
      },
    },
  },
  ...
};
```

As you can see this is quite restrictive. `exec-defaults.ts` provides default bin paths and profiles to make it a bit easier:

```ts
import { exec } from '../greg/config';

const config: Config = {
  ...
  guard: {
      ...
      exec: {
        profiles: exec.profiles,
        allowBins: exec.merge<typeof exec.profiles>(
          exec.readOnly,
          exec.safeWrite
        ),
      },
    },
  },
  ...
};
```

Next, you can control where Greg can both read and write files to. By default he's allowed to both read and write to `~/.greg/workspace` and `/tmp/greg`. You can allow more paths through `tools.guard.files`:

```ts
import { exec } from '../greg/config';

const config: Config = {
  ...
  guard: {
      ...
      files: {
        read: ['~/path/to/code'],
        write: ['~/path/to/code', '!~/path/to/code/but/not/this/folder'],
      },
    },
  },
  ...
};
```

The purpose of the Guard is to reduce the risk Greg does something you don't want due to misunderstanding or confusion, and exfiltration risk (attackers transfering data without your permission). Next to using the Guard it's important to use a reliable LLM provider and frontier model when using Greg. Providers like Anthropic both run classifiers on incoming data and train their frontier models on prompt injection techniques. Using the newest models helps reduce the risk of prompt injection, and being careful with what you allow Greg to do through the Guard prevents the risk of what could happen in case prompt injection does happen.

If you're concerned about privacy and want to use a local model you can configure a [custom model](https://github.com/badlogic/pi-mono/tree/main/packages/ai#custom-models). Be extra careful when you do this because local models don't have the same protection the large providers and frontier models offer.

## 📱 Clients

### Telegram

The recommended to use Greg is through Telegram. Greg comes with a `greg telegram` command that lets both you and Greg send text and voice messages to the Telegram bot configured in your `~/.greg/config.ts` file.

### TUI

Additionally, Greg comes with a TUI that's available through `greg tui`. The TUI can also be used to work with Greg through your command-line:

```bash
cat ~/path/to/some/file.md | greg tui -p "Summarize this file"
```

### Custom

You can also create a custom client to communicate with Greg:

```ts
// clients/your-custom-client.ts
// run using `bun run clients/your-custom-client.ts`

import rl from 'node:readline/promises';
import * as gateway from '../gateway';

const { setGetReply, stop } = await gateway.start();
const session = gateway.get('main');

session.subscribe('your-channel-name', {
  onTurnStart: () => {},
  onThinking: (chunk) => {},
  onContent: (chunk) => {},
  onToolcall: async (name, args) => {},
  onTurnDone: async () => {},
  onTurnStop: () => {},
  onError: (error) => {},
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

setGetReply(rl.question.bind(rl));

await session.prompt(
  {
    content: 'Hey Greg!',
    images: [],
  },
  { channelId: 'your-channel-name' }
);

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  stop();
  process.exit(0);
}
```
