import { Agent } from '@mariozechner/pi-agent-core';
import type { Model, Api, ImageContent } from '@mariozechner/pi-ai';
import { getInstructions as getToolsInstructions, tools } from '../tools';
import { formatDate } from '../utilities';
import { compactContext, deriveContextTokens } from './compaction';
import { listCommands, parseCommands } from './commands';
import { getWorkspacePath } from '../utilities';
import config from '../../.greg';
import pc from 'picocolors';

export type PromptOptions = {
  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  onDone: () => void;
  onToolcall: (name: string, args: Record<string, unknown>) => void;
  onError: (err: string) => void;
  onStop: () => void;
};

type Image = {
  data: string;
  mimeType: string;
};

export type PromptInput = { content: string; images: Image[] };

export type Thread = {
  working: boolean;
  abort(): void;
  prompt: (content: PromptInput, options: PromptOptions) => Promise<void>;
};

export async function thread(): Promise<Thread> {
  let abortController: AbortController | null = null;
  const conversationStartIso = new Date().toISOString();
  const system = `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers.
You have control over my computer through several tools and skills.

You must never make up or assume facts, behaviors, or code. If you are missing information, unsure, or something is ambiguous, either ask me a concise clarifying question or explicitly say that you do not know or cannot determine the answer. Prefer using your tools and reading from the actual environment over guessing, and do not rely on later corrections from me.

${getToolsInstructions(conversationStartIso)}

## Environment
- The code you're running on is at: ${process.cwd()}.
- Your workspace is at: ${getWorkspacePath()}. This is where you store your memory and notes.

### Error reporting
If any tool call returns an error, always explicitly tell the user:
- What tool/command failed
- What the error was

Do not silently skip, retry without mentioning it, or paper over failures.

### Restarting yourself
If you ever need to fully restart yourself (for example after configuration changes or if you are stuck), you can call the \`exec\` tool with the command \`greg restart\`. Before doing so, you MUST: (1) call \`save_conversation_note\` with a concise summary of the current conversation so you can later reload it and know where you left off, (2) tell the user explicitly that you are about to restart, then (3) run the restart command.

### Logs
Your logs are available through \`greg logs\`. Run \`greg logs --lines <number>\` to see the last <number> lines.
`;

  const agent = new Agent({
    initialState: {
      systemPrompt: system,
      model: config.models.find((model) => model.role === 'primary')!.model,
      thinkingLevel: 'medium',
      tools,
      messages: [],
    },
    getApiKey(provider) {
      const key =
        config.models.find((model) => model.model.provider === provider)?.key ??
        null;
      if (!key) {
        throw new Error(
          `No API key found for provider "${provider}" in config.models.`
        );
      }
      return key;
    },
    transformContext: compactContext,
  });

  let lastModel: Model<Api> | null = null;
  const primaryModel = config.models.find(
    (model) => model.role === 'primary'
  )!.model;

  return {
    working: abortController !== null,
    abort: () => {
      abortController?.abort();
      abortController = null;
    },
    prompt: async (
      input: PromptInput,
      {
        onContent,
        onThinking,
        onToolcall,
        onDone,
        onError,
        onStop,
      }: PromptOptions
    ) => {
      const parsed = parseCommands({
        content: input.content,
        currentModel: agent.state.model ?? primaryModel,
        primaryModel,
        config,
      });

      if (parsed.status === 'error') {
        onError(parsed.message);
        return;
      }

      if (parsed.result.stopRequested) {
        if (abortController === null) {
          onContent('Nothing to stop.');
          onDone();
          return;
        }
        abortController?.abort();
        return;
      }

      if (parsed.result.helpRequested) {
        const commands = listCommands(config);
        onContent(['Available commands:', '', ...commands].join('\n'));
        onDone();
        return;
      }

      const model = parsed.result.model ?? primaryModel;
      const thinkingLevel = parsed.result.thinkingLevel ?? 'medium';

      if (parsed.result.statusRequested) {
        let contextLine: string;
        try {
          const contextTokens = deriveContextTokens(agent.state.messages);
          const contextWindow = lastModel?.contextWindow ?? 0;
          const percentage =
            contextWindow > 0
              ? Math.min(100, (contextTokens / contextWindow) * 100).toFixed(1)
              : '0.0';
          contextLine = `📊 ${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${percentage}%)`;
        } catch {
          contextLine = '📊 Tokens: unknown';
        }
        onContent(
          [
            'Status:',
            `🧠 Model: ${lastModel ? lastModel.name : 'nothing sent yet'}`,
            `💭 Thinking: ${thinkingLevel}`,
            contextLine,
            `🕵️‍♂️ Busy: ${abortController !== null ? 'Yes (send /stop to stop)' : 'No. Ready for a new task.'}`,
            `\nOptions given for this prompt:`,
            `- Model: ${model.name}`,
            `- Thinking: ${thinkingLevel}`,
          ]
            .filter(Boolean)
            .join('\n')
        );
        onDone();
        return;
      }

      if (abortController !== null) {
        onError('Working on your previous request. Send /stop to abort.');
        return;
      }

      abortController = new AbortController();

      agent.setModel(model);
      lastModel = model;

      agent.setThinkingLevel(thinkingLevel);

      const nowIso = new Date().toISOString();
      const messageWithMeta = `Date and time is ${formatDate(
        nowIso
      )}. User sent this prompt: "${parsed.cleanPrompt}"`;

      console.info(pc.gray(`\n"${messageWithMeta}"`));

      const modelLabel = agent.state.model?.name;
      console.info(pc.gray(`Using ${modelLabel}.`));

      const unsubscribe = agent.subscribe((event) => {
        switch (event.type) {
          case 'message_update':
            if (
              event.assistantMessageEvent.type === 'text_delta' &&
              event.assistantMessageEvent.delta.trim() !== ''
            ) {
              onContent(event.assistantMessageEvent.delta);
            } else if (event.assistantMessageEvent.type === 'thinking_delta') {
              onThinking(event.assistantMessageEvent.delta);
            }
            break;
          case 'tool_execution_start':
            onToolcall(
              event.toolName,
              (event as { args?: Record<string, unknown> }).args ?? {}
            );
            console.info(
              pc.cyan(
                `[${event.toolName}(${JSON.stringify((event as { args?: unknown }).args)})]`
              )
            );
            break;
          case 'tool_execution_end':
            console.info(pc.gray(JSON.stringify(event.result)));
            break;
          case 'agent_end':
            console.info(pc.green('Done.\n'));
            onDone();
            break;
          default:
            break;
        }
      });

      const signal = abortController.signal;
      const startMessageCount = agent.state.messages.length;
      let aborted = false;

      if (signal?.aborted) {
        aborted = true;
        agent.abort();
        onStop();
        return;
      }

      signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
          agent.abort();
          onStop();
        },
        { once: true }
      );

      const images = input.images ?? [];
      const imageContents: ImageContent[] = images.map((img) => ({
        type: 'image' as const,
        data: img.data,
        mimeType: img.mimeType,
      }));

      try {
        await agent.prompt(messageWithMeta, imageContents);

        if (agent.state.error) {
          const isPrimaryModel =
            agent.state.model?.id === primaryModel.id &&
            agent.state.model?.provider === primaryModel.provider;
          if (
            isPrimaryModel &&
            (agent.state.error.includes('overloaded') ||
              agent.state.error.includes('rate') ||
              agent.state.error.includes('capacity'))
          ) {
            const fallbackModel =
              config.models.find((model) => model.role === 'fallback')?.model ??
              null;
            if (!fallbackModel) {
              onError(`No fallback model found in config.models.`);
              return;
            }
            console.info(
              pc.yellow(
                `${modelLabel} is overloaded. Trying again with ${fallbackModel.name}.`
              )
            );
            agent.setModel(fallbackModel);
            agent.replaceMessages(agent.state.messages.slice(0, -1));
            await agent.continue();
          } else {
            onError(agent.state.error);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isAbortError =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            message.toLowerCase().includes('aborted') ||
            message.toLowerCase().includes('canceled'));

        if (isAbortError) {
          aborted = true;
        } else {
          onError(message);
        }
      } finally {
        if (aborted) {
          agent.replaceMessages(agent.state.messages.slice(0, startMessageCount));
        }
        abortController = null;
        unsubscribe();
      }
    },
  };
}
