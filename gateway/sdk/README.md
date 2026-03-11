```ts
import {
  Session,
} from 'agent/Agent/sdk';

if (!(await Session.agentOnline())) {
  throw new Error('Agent not online'):
}

const session = await Session.create();

session.listen({
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
