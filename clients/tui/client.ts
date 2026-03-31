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

export interface Client {
  prompt: (content: string) => Promise<void>;
  onPermissionRequest: (
    callback: (commands: Record<string, string>) => void
  ) => void;
  onPermissionRequestDone: (callback: () => void) => void;
  usage: gateway.Session['usage'];
}

export async function client(
  sessionId: string,
  callbacks: gateway.Callbacks & {
    getReply?: (message: string) => Promise<string>;
  }
): Promise<Client> {
  let onPermissionRequest: ((commands: Record<string, string>) => void) | null =
    null;
  let onPermissionRequestDone: (() => void) | null = null;

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
      onPermissionRequest?.(details.commands);
      const reply = await callbacks.getReply(
        `${pc.dim('💂 Need permission to run tool:')}\n\n${pc.yellow(details.toolName)}${pc.dim(`(${details.prettyParams})`)}`
      );
      onPermissionRequestDone?.();
      return reply;
    });
  }

  return {
    get usage() {
      return session.usage;
    },
    onPermissionRequest: (
      callback: (commands: Record<string, string>) => void
    ) => {
      onPermissionRequest = callback;
    },
    onPermissionRequestDone: (callback: () => void) => {
      onPermissionRequestDone = callback;
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
