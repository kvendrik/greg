import type { NeutralMessage, ProviderId } from './providers/types';
import type { NeutralThinking } from './providers/types';
import { get as getTools, getInstructions } from '../tools';
import { formatDate } from '../utilities';
import {
  classifyComplexity,
  prepareMessages,
  getErrorMessage,
} from './utilities';
import { providers } from './providers';
import pc from 'picocolors';

export type PromptOptions = {
  signal: AbortSignal;
  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  onDone: () => void;
  onToolcall: (name: string, args: Record<string, unknown>) => void;
  onError: (err: string) => void;
};

export async function thread(): Promise<{
  prompt: (content: string, options: PromptOptions) => Promise<void>;
}> {
  const conversationStartIso = new Date().toISOString();
  let messages: NeutralMessage[] = [];

  const system = `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers. 
You have control over my computer through several tools and skills.

${getInstructions(conversationStartIso)}

The code you're running on is at: ${process.cwd()}.
`;

  return {
    prompt: async (
      content: string,
      {
        signal,
        onContent,
        onThinking,
        onToolcall,
        onDone,
        onError,
      }: PromptOptions
    ) => {
      const command = content.match(/^\/([^\s]+) ([^\s]+)/);

      let defaultProviderId: ProviderId = 'anthropic';
      let thinkingEffort: NeutralThinking = 'medium';

      if (command) {
        switch (command[1]) {
          case 'openai':
            defaultProviderId = 'openai';
            break;
          case 'thinking':
            const thinking = command[2] as NeutralThinking | 'none';
            if (
              thinking !== 'low' &&
              thinking !== 'medium' &&
              thinking !== 'high' &&
              thinking !== 'max' &&
              thinking !== 'none'
            ) {
              onError(
                `Invalid thinking level: "${thinking}". Available levels: low, medium, high, max, none`
              );
              return;
            }
            thinkingEffort =
              thinking === 'none' ? null : (thinking as NeutralThinking);
            break;
          default:
            onError(
              `Unknown command: "${command[1]}". Available commands: /m:provider`
            );
        }
      }

      await runPrompt(
        defaultProviderId,
        content.replace(command?.[0] ?? '', ''),
        {
          signal,
          system,
          messages,
          conversationStartIso,
          thinking: thinkingEffort,
          onContent,
          onThinking,
          onToolcall,
          onDone(newMessages) {
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
  providerId: ProviderId,
  content: string,
  opts: {
    signal: AbortSignal;
    system: string;
    messages: NeutralMessage[];
    conversationStartIso: string;
    thinking: NeutralThinking;
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
    onToolcall: (name: string, args: Record<string, unknown>) => void;
    onDone: (messages: NeutralMessage[]) => void;
    onError: (err: string) => void;
  }
) {
  const nowIso = new Date().toISOString();
  const userContent = `Date and time is ${formatDate(nowIso)}. User sent this prompt: "${content}"`;

  console.info(pc.gray(`\n"${userContent}"`));

  //const resolved = await resolveModel(providerId, userContent, opts.signal);
  const provider = providers[providerId];
  const resolved = provider.models.normal;

  const tools = await getTools(opts.signal);

  const prepared = await prepareMessages({
    providerEntry: provider,
    system: opts.system,
    messages: opts.messages,
    newUserContent: userContent,
    conversationStartIso: opts.conversationStartIso,
    model: resolved.modelId,
    tools,
  });

  console.info(pc.gray(`Using ${resolved.label}.`));
  opts.onContent(`Using ${resolved.label}.\n\n`);

  await provider.run(
    {
      system: opts.system,
      messages: prepared,
      model: resolved.modelId,
      thinking: 'medium',
      conversationStartIso: opts.conversationStartIso,
      signal: opts.signal,
      tools,
    },
    {
      onContent: opts.onContent,
      onThinking: opts.onThinking,
      onToolCall(name, args) {
        console.info(pc.cyan(`[${name}(${args})]`));
        opts.onToolcall(name, args);
      },
      onDone(messages) {
        opts.onDone(messages);
        console.info(pc.green(`Done.\n`));
      },
      async onError(errorType) {
        if (errorType === 'overloaded' && providerId === 'anthropic') {
          console.info(
            pc.yellow('Claude is overloaded. Trying again with OpenAI.')
          );
          await runPrompt('openai', content, opts);
          return;
        }
        opts.onError(getErrorMessage(errorType));
      },
    }
  );
}
