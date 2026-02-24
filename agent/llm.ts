import { get as getTools, getInstructions } from './tools';
import { formatDate } from './utilities';
import { prepareMessages, MODEL } from './context';
import { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { spawn } from 'node:child_process';

const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 25;

type ThreadHistory = {
  system: string;
  messages: BetaMessageParam[];
  conversationStartIso: string;
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function start() {
  return {
    kill: () => {},
    thread: await thread(),
  };
}

async function thread() {
  const conversationStartIso = new Date().toISOString();
  const baseInstructions = `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers. 
You have control over my computer through several tools and skills.

${getInstructions(conversationStartIso)}

The code you're running on is at: ${process.cwd()}.
`;

  let messages: BetaMessageParam[] = [];

  return {
    prompt: async (
      content: string,
      {
        signal,
        onContent,
        onThinking,
        onDone,
      }: {
        signal?: AbortSignal;
        onContent: (chunk: string) => void;
        onThinking: (chunk: string) => void;
        onDone: () => void;
      }
    ) => {
      const nowIso = new Date().toISOString();
      const finalContent = `Date and time is ${formatDate(nowIso)}. User sent this prompt: "${content}"`;
      await runPrompt(finalContent, {
        signal,
        history: {
          system: baseInstructions,
          messages,
          conversationStartIso,
        },
        onContent,
        onThinking,
        onDone: (newMessages) => {
          messages = newMessages;
          onDone();
        },
      });
    },
  };
}

async function runPrompt(
  content: string,
  opts: {
    signal?: AbortSignal;
    history: ThreadHistory;
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
    onDone: (messages: BetaMessageParam[]) => void;
  }
) {
  const runnableTools = await getTools(opts.signal);

  const messages = await prepareMessages({
    system: opts.history.system,
    messages: opts.history.messages as MessageParam[],
    newUserContent: content,
    tools: runnableTools,
    conversationStartIso: opts.history.conversationStartIso,
  });

  const runner = anthropic.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: opts.history.system,
      messages: messages as BetaMessageParam[],
      tools: runnableTools,
      tool_choice: { type: 'auto' },
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      max_iterations: MAX_ITERATIONS,
    },
    { signal: opts.signal } as { headers?: Record<string, string> }
  );

  for await (const value of runner) {
    if (
      value &&
      typeof value === 'object' &&
      'on' in value &&
      typeof (value as { on: unknown }).on === 'function'
    ) {
      const stream = value as {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
      };
      stream.on('text', (delta: string) => opts.onContent(delta));
      stream.on('thinking', (delta: string) => opts.onThinking(delta));
      stream.on(
        'contentBlock',
        (block: { type: string; name?: string; input?: unknown }) => {
          if (block.type === 'tool_use' && block.name != null) {
            opts.onThinking(
              `\n\n[${block.name}(${JSON.stringify(block.input ?? {})})]`
            );
          }
        }
      );
    }
  }

  opts.onDone(runner.params.messages);
}
