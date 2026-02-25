import type { NeutralMessage, ProviderId } from './providers/types';
import { get as getTools, getInstructions } from '../tools';
import { formatDate } from '../utilities';
import { resolveModel, prepareMessages, getErrorMessage } from './utilities';
import { providers } from './providers';
import pc from 'picocolors';

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
      { signal, onContent, onThinking, onDone, onError }: PromptOptions
    ) => {
      await runPrompt('anthropic', content, {
        signal,
        system,
        messages,
        conversationStartIso,
        onContent,
        onThinking,
        onDone(newMessages) {
          messages = newMessages;
          onDone();
        },
        onError,
      });
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
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
    onDone: (messages: NeutralMessage[]) => void;
    onError: (err: string) => void;
  }
) {
  const nowIso = new Date().toISOString();
  const userContent = `Date and time is ${formatDate(nowIso)}. User sent this prompt: "${content}"`;

  console.info(pc.gray(`\n"${userContent}"`));

  const resolved = await resolveModel(userContent, opts.signal, providerId);
  const provider = providers[providerId];

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

  await provider.run(
    {
      system: opts.system,
      messages: prepared,
      model: resolved.modelId,
      conversationStartIso: opts.conversationStartIso,
      signal: opts.signal,
      tools,
    },
    {
      onContent: opts.onContent,
      onThinking: opts.onThinking,
      onToolCall(name, args) {
        console.info(pc.cyan(`[${name}(${args})]`));
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
