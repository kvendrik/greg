import { Agent } from '@mariozechner/pi-agent-core';
import type { Model, Api, ImageContent } from '@mariozechner/pi-ai';
import { getInstructions as getToolsInstructions, tools } from '../tools';
import { formatDate } from '../utilities';
import { compactContext, deriveContextTokens } from './compaction';
import { parseCommands } from './commands';
import { getWorkspacePath } from '../utilities';
import config from '../../.greg';
import pc from 'picocolors';

export type PromptOptions = {
  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  onDone: () => void;
  onToolcall: (name: string, args: Record<string, unknown>) => void;
  onError: (err: string) => void;
};

type Image = {
  data: string;
  mimeType: string;
};

export type PromptInput = { content: string; images: Image[] };

export type Thread = {
  prompt: (content: PromptInput, options: PromptOptions) => Promise<void>;
  abort: () => void;
};

export async function thread(): Promise<Thread> {
  const abortController = new AbortController();
  const conversationStartIso = new Date().toISOString();
  const system = `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers. 
You have control over my computer through several tools and skills.

${getToolsInstructions(conversationStartIso)}

## Environment
- The code you're running on is at: ${process.cwd()}.
- Your workspace is at: ${getWorkspacePath()}. This is where you store your memory and notes.
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
    abort: () => abortController.abort(),
    prompt: async (
      input: PromptInput,
      { onContent, onThinking, onToolcall, onDone, onError }: PromptOptions
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

      const model = parsed.result.model ?? primaryModel;
      const thinkingLevel = parsed.result.thinkingLevel ?? 'medium';

      if (parsed.result.statusRequested) {
        let contextLine: string;
        try {
          const contextTokens = deriveContextTokens(agent.state.messages);
          const contextWindow = model.contextWindow;
          const percentage =
            contextWindow > 0
              ? Math.min(100, (contextTokens / contextWindow) * 100).toFixed(1)
              : '0.0';
          contextLine = `📊 Context: ${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${percentage}%)`;
        } catch {
          contextLine = '📊 Context: unknown';
        }
        onContent(
          [
            'Status:',
            lastModel && `🧠 Last model used: ${lastModel.name}`,
            `🧠 Model for this prompt: ${model.name}`,
            `💭 Thinking: ${thinkingLevel}`,
            contextLine,
          ]
            .filter(Boolean)
            .join('\n')
        );
        onDone();
        return;
      }

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

      if (abortController.signal?.aborted) {
        agent.abort();
      }

      abortController.signal?.addEventListener(
        'abort',
        () => {
          agent.abort();
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
        const msg = err instanceof Error ? err.message : String(err);
        onError(msg);
      } finally {
        unsubscribe();
      }
    },
  };
}
