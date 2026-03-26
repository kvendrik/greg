import * as gateway from '../../gateway';
import pc from 'picocolors';

// const c = await client({
//   onContent(chunk) {
//     console.log('onContent', chunk);
//   },
//   onError(error) {
//     console.log('onError', error);
//   },
// });

// void c.prompt('Hello, world!');

export async function client(
  sessionId: string,
  callbacks: gateway.Callbacks & {
    getReply?: (message: string) => Promise<string>;
  }
): Promise<{
  prompt: (content: string) => Promise<void>;
  onCommands: (callback: (commands: Record<string, string>) => void) => void;
}> {
  let onCommands: ((commands: Record<string, string>) => void) | null = null;

  const { setGetReply } = await gateway.start();

  if (!gateway.exists(sessionId)) {
    await gateway.create(sessionId);
    await gateway.load(sessionId);
  }

  const session = gateway.get(sessionId);
  session.subscribe('tui', callbacks);

  if (callbacks.getReply) {
    setGetReply(async (_message, details) => {
      if (!callbacks.getReply) {
        return '';
      }
      onCommands?.(details.commands);
      const reply = await callbacks.getReply(
        `${pc.yellow(details.toolName)}${pc.dim(`(${details.prettyParams})`)}`
      );
      return reply;
    });
  }

  return {
    onCommands: (callback: (commands: Record<string, string>) => void) => {
      onCommands = callback;
    },
    prompt: async (content: string): Promise<void> =>
      session.prompt(
        {
          content,
          images: [],
        },
        { channelId: 'tui' }
      ),
  };
}
