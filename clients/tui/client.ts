import * as gateway from '../../gateway';

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
  callbacks: gateway.Callbacks & {
    getReply?: (message: string) => Promise<string>;
  }
): Promise<{
  prompt: (content: string) => Promise<void>;
}> {
  process.env.GREG_LOG = 'silent';

  const { setGetReply } = await gateway.start();

  const session = gateway.get('main');
  session.subscribe('tui', callbacks);

  if (callbacks.getReply) {
    setGetReply(async (_message, _details) => {
      if (!callbacks.getReply) {
        return '';
      }
      const reply = await callbacks.getReply(_message);
      return reply;
    });
  }

  return {
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
