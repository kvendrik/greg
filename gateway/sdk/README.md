```ts
import {
  ping as pingAgent,
  Session,
} from './gateway/sdk';

if (!(await pingAgent())) {
  throw new Error('Agent not online'):
}

// connects to main session. To create a new
// session use Session.create()
const session = await Session.existing('main', 'your_channel_id');

await session.connect();

session.subscribe({
  onThinking(chunk) {},
  onContent(chunk) {},
  onToolcall() {},
  onDone() {},
  onStop() {},
  onError() {},
});

await session.prompt({ content: 'Hi', images: [] });

// Agent might send content at any time, not just when you've prompted it.
// Reason is that the Agent might end a turn and later send updates on an async operation.

await session.destroy();
```
