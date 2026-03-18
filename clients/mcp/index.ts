import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { start, get } from '../../gateway';

// MCP stdio uses stdout for JSON-RPC — redirect logging to stderr
// so Greg's logger doesn't corrupt the protocol stream.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

const server = new McpServer(
  { name: 'greg', version: '1.0.0' },
  { capabilities: { logging: {} } }
);

server.registerTool(
  'prompt',
  {
    description:
      'Send a message to Greg, a personal assistant with access to tools like terminal commands, memory/notes, web search, browser automation, and file editing. Streams progress notifications with content chunks while running.',
    inputSchema: {
      message: z.string().describe('The message to send to Greg'),
    },
  },
  async ({ message }, extra) => {
    const session = get('main');

    const text = await new Promise<string>((resolve) => {
      let chunkIndex = 0;
      const chunks: string[] = [];
      const progressToken = extra._meta?.progressToken;

      const streamChunk = (msg: string) => {
        if (progressToken === undefined) return;
        extra
          .sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress: ++chunkIndex, message: msg },
          })
          .catch(() => {});
      };

      if (extra.signal.aborted) {
        resolve('Cancelled.');
        return;
      }

      extra.signal.addEventListener(
        'abort',
        () => {
          session.abort();
        },
        { once: true }
      );

      session
        .prompt(
          {
            content: `${message}\n\n[Message was sent from MCP]`,
            images: [],
          },
          {
            channelId: 'mcp',
            signal: extra.signal,
            callbacks: {
              onContent: (chunk) => {
                chunks.push(chunk);
                streamChunk(chunk);
              },
              onToolcall: (name, args) => {
                server
                  .sendLoggingMessage({
                    level: 'info',
                    data: `[tool] ${name}(${JSON.stringify(args)})`,
                  })
                  .catch(() => {});
              },
              onTurnDone: () => resolve(chunks.join('')),
              onError: (error) => {
                const collected = chunks.join('');
                resolve(
                  collected
                    ? `${collected}\n\nError: ${error}`
                    : `Error: ${error}`
                );
              },
              onTurnStop: () => resolve(chunks.join('') || 'Stopped.'),
            },
          }
        )
        .catch((err) => {
          resolve(
            `Error: ${err instanceof Error ? err.message : String(err)}`
          );
        });
    });

    return {
      content: [{ type: 'text' as const, text: text || '(no response)' }],
    };
  }
);

server.registerTool(
  'stop',
  {
    description:
      'Abort the currently running Greg prompt. No-op if Greg is idle.',
  },
  async () => {
    const session = get('main');

    if (!session.working) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Greg is not currently working on anything.',
          },
        ],
      };
    }

    session.abort();

    return {
      content: [{ type: 'text' as const, text: 'Stopped.' }],
    };
  }
);

server.registerTool(
  'status',
  {
    description: 'Check whether Greg is currently working on a task.',
  },
  async () => {
    const session = get('main');

    return {
      content: [
        {
          type: 'text' as const,
          text: session.working
            ? 'Greg is currently working. Use the stop tool to abort.'
            : 'Greg is idle and ready for a new task.',
        },
      ],
    };
  }
);

const { stop } = await start();

get('main').subscribe('mcp', {});

const transport = new StdioServerTransport();
await server.connect(transport);

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function shutdown() {
  stop();
  server.close().catch(() => {});
  process.exit(0);
}
