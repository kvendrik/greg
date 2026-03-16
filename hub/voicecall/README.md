# 📞 Voicecall

Task-based voice calls agent controllable through a SDK or CLI.

## Get started

Start by running the `doctor` command to ensure you have all dependencies set up:

```bash
voicecall doctor
```

## CLI

```bash
voicecall call
    --to +3102012345678
    --task "Book a table for 2 at 6pm. If 6pm is not available, anything between 7 and 9 works."
    --context "Your name is Greg. You’re Koen’s personal assistant."
```

## SDK

```ts
import { callWithTask } from './task';

const { conclusion } = await callWithTask({
  to: '+3102012345678',
  task: 'Book a table for 2 at 6pm. If 6pm is not available, anything between 7 and 9 works.',
  context: 'Your name is Greg. You’re Koen’s personal assistant.',
});

// Example: "Booked a table for 7:30pm"
console.log(conclusion);
```

## Customization

The agent defaults to using [Claude Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6). You can pass in a session creation method yourself to use a different model:

```ts
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { callWithTask } from './task';

const { conclusion } = await callWithTask({
  to: '+3102012345678',
  task: 'Book a table for 2 at 6pm. If 6pm is not available, anything between 7 and 9 works.',
  context: 'Your name is Greg. You’re Koen’s personal assistant.',
  createAgent,

  // Optional callbacks for various events:
  onStart: (callId) => console.log('Call started:', callId),
  onConnect: () => console.log('Caller picked up.'),
  onSpeech: ({ role, text }) => console.log(`${role}: ${text}`),
});

// Example: "Booked a table for 7:30pm"
console.log(conclusion);

async function createAgent(systemPrompt: string) {
  const auth = AuthStorage.create();

  const { session } = await createAgentSession({
    model: getModel('google', 'gemini-3-flash-preview'), // will require GEMINI_API_KEY to be set
    thinkingLevel: 'off',
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: new ModelRegistry(auth),
    tools: [
      /**
       * Optional:
       * Example tool to enable the agent to look through the user’s calendar
       */
      {
        name: 'get_calendar_events',
        label: 'get calendar events',
        description: 'Get all calendar events for a given date',
        parameters: Type.Object({
          date: Type.String({
            description:
              'The date to get calendar events for in YYYY-MM-DD format',
          }),
        }),
        execute: async (_id, { date }, signal) => {
          let events: string[] = [];
          return {
            content: [
              {
                type: 'text' as const,
                text: `Calendar events for ${date}: ${JSON.stringify(events)}`,
              },
            ],
            details: {},
          };
        },
      },
    ],
  });

  session.agent.state.systemPrompt = systemPrompt;
  return session;
}
```
