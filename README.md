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
- 🗣️ **Voice Messages**. Greg ships with a Telegram integration that is capable of sending voice messages by transcribing his responses using [ElevenLabs](https://elevenlabs.io/). This does require a ElevenLabs API key. See "Voice Messages" below for more info.
- 📞 **Voice Calls**. Greg ships with [tools](hub/voicecall) that allow him to place voice calls using [ElevenLabs](https://elevenlabs.io/) and [Twilio](https://www.twilio.com). Running `greg doctor` will help you understand what environment variables are needed to make this work.

Oh and you don't have to call him Greg. Just say "From now on your name is John" and that's it.

## Setup

1. Clone this repository, install the dependencies, and `link` so you have access to the CLI

```bash
git clone git@github.com:kvendrik/greg.git
cd greg

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
      key: '..', // https://platform.claude.com
    },
  ],
  tools: {
    webSearch: {
      provider: 'brave',
      key: '..', // https://brave.com/search/api/
    },
    /**
     * Optional:
     * Blocks risky tool calls (all `exec` functionality, file writes, and web fetching)
     * by default and will ask you for permission to run them (when `ask` is enabled).
     */
    guard: {
      enabled: true,
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
    },
  },
  /**
   * Optional:
   * Use the heartbeat. Greg will read [workspace]/HEARTBEAT.md
   * every X minutes to check for things to do.
   */
  heartbeat: {
    enabled: true,
    interval: 30,
  },
  /**
   * Optional:
   * Use voice functionality
   * Features: voice messages, voice calls, and voice mode in the TUI.
   */
  voice: {
    elevenlabs: {
      key: '..', // https://elevenlabs.io/app/api/api-keys
      voiceId: '..', // https://elevenlabs.io/app/api/voice-library
    },
  },
  /**
   * Optional:
   * Use communication through Telegram
   * Other options are the TUI or a custom client (see below)
   */
  telegram: {
    botToken: '...', // https://core.telegram.org/api
    senderId: '..', // curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
  },
};

export default config;
```

See the [`Config type`](config/types.ts) for all config options.

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

Greg can be taught how to do anything by simply telling him to read an [AgentSkill](https://agentskills.io) and to save it for later use. Doing so will cause Greg to save a new skill to your workspace.

## 📦 Hub

Greg also ships with a couple of CLI's that I couldn't find good versions of elsewhere. These are available through the `greg hub` command.

Greg already knows how to use them as all `hub/*/AGENT.md` files are loaded as skills by default. `greg doctor` will warn you if any of the CLIs doesn't have its dependencies installed. Greg might try to use one of the CLI's, discover he can’t because he's missing dependencies, and ask you about it.

CLI's in the Hub:

- `greg hub notion` provides a read-only CLI for Notion for Greg to use
- `greg hub strava` provides a read-only CLI for Strava for Greg to use
- `greg hub voicecall` provides a CLI for Greg to make voicecalls through Twilio

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
