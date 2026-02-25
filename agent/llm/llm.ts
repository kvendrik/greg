import { get as getTools, getInstructions } from '../tools';
import { formatDate } from '../utilities';
import { prepareMessages } from './context';
import { resolveModel } from './router';
import { getErrorMessage } from './errors';
import { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import pc from 'picocolors';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ThreadHistory = {
  system: string;
  messages: BetaMessageParam[];
  conversationStartIso: string;
};

export type PromptOptions = {
  signal: AbortSignal;
  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
};

export async function thread(): Promise<{
  prompt: (content: string, options: PromptOptions) => Promise<void>;
}> {
  const conversationStartIso = new Date().toISOString();
  let messages: BetaMessageParam[] = [];

  return {
    prompt: async (
      content: string,
      { signal, onContent, onThinking, onDone, onError }: PromptOptions
    ) => {
      const nowIso = new Date().toISOString();
      await runPrompt(
        `Date and time is ${formatDate(nowIso)}. User sent this prompt: "${content}"`,
        {
          signal,
          history: {
            system: `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers. 
You have control over my computer through several tools and skills.

${getInstructions(conversationStartIso)}

The code you're running on is at: ${process.cwd()}.
`,
            messages,
            conversationStartIso,
          },
          onContent,
          onThinking,
          onDone: (newMessages) => {
            messages = newMessages;
            onDone();
          },
          onError,
        }
      );
    },
  };
}

async function runPrompt(
  content: string,
  opts: {
    signal: AbortSignal;
    history: ThreadHistory;
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
    onDone: (messages: BetaMessageParam[]) => void;
    onError: (err: string) => void;
  }
) {
  console.info(pc.gray(`\n"${content}"`));

  const model = await resolveModel(content, opts.signal);
  const runnableTools = await getTools(opts.signal);

  const messages = await prepareMessages({
    system: opts.history.system,
    messages: opts.history.messages as MessageParam[],
    newUserContent: content,
    tools: runnableTools,
    conversationStartIso: opts.history.conversationStartIso,
    model: model.id,
  });

  const runner = anthropic.beta.messages.toolRunner(
    {
      model: model.id,
      max_tokens: 8192,
      system: opts.history.system,
      messages: messages as BetaMessageParam[],
      tools: runnableTools,
      tool_choice: { type: 'auto' },
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      max_iterations: 25,
    },
    { signal: opts.signal } as { headers?: Record<string, string> }
  );

  console.info(pc.gray(`Using ${model.label}.`));

  try {
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
        stream.on('error', (err: unknown) => {
          opts.onError(getErrorMessage(err));
          console.error(pc.red('Stream error:'), err);
        });
        stream.on('text', (delta: string) => opts.onContent(delta));
        stream.on('thinking', (delta: string) => opts.onThinking(delta));
        stream.on(
          'contentBlock',
          (block: { type: string; name?: string; input?: unknown }) => {
            if (block.type === 'tool_use' && block.name != null) {
              let inputStr = '{}';
              try {
                inputStr =
                  typeof block.input === 'string'
                    ? block.input
                    : JSON.stringify(block.input ?? {});
              } catch {
                inputStr = String(block.input);
              }
              console.info(pc.cyan(`[${block.name}(${inputStr})]`));
            }
          }
        );
      }
    }

    console.info(pc.green(`Done.\n`));
    opts.onDone(runner.params.messages);
  } catch (err) {
    opts.onError(getErrorMessage(err));
    console.error(pc.red('LLM run failed:'), err);
    throw err;
  }
}
