import {
  Agent as CoreAgent,
  type AgentMessage,
} from '@mariozechner/pi-agent-core';
import type { Model, Api, ImageContent } from '@mariozechner/pi-ai';
import { compactContext, deriveContextTokens } from './compaction';
import { listCommands, parseCommands } from './commands';
import { get as getTools } from './tools';
import { formatDate, getWorkspacePath } from './utilities';
import type { AgentConfig, ToolContext } from './types';
import { createLogger, type Logger } from '../utilities/logger';

export type Callbacks = Partial<{
  onTurnStart: (prompt: PromptInput) => void;

  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;

  onToolcall: (name: string, args: Record<string, unknown>) => void;
  onToolcallResult?: (name: string, result: string) => void;

  onTurnDone: (newMessages?: AgentMessage[]) => void;
  onTurnStop: () => void;
  onError: (error: string) => void;
}>;

type Image = {
  data: string;
  mimeType: string;
};

export type PromptInput = { content: string; images: Image[] };

export interface AgentOptions extends ToolContext {
  messages: AgentMessage[];
  onCompact?: (newMessages: AgentMessage[]) => Promise<void>;
  getSystemPrompt?: (toolInstructions: string, config: AgentConfig) => string;
}

export class Agent {
  private readonly core: CoreAgent;
  private readonly logger: Logger;
  private readonly primaryModel: Model<Api>;
  private readonly config: AgentConfig;
  private readonly callbacks = new Map<string, Callbacks[]>();

  private abortController: AbortController | null = null;
  private lastModel: Model<Api> | null = null;

  private constructor(core: CoreAgent, config: AgentConfig) {
    this.core = core;
    const primaryEntry = config.models.find(
      (model) => model.role === 'primary'
    );
    if (!primaryEntry) {
      throw new Error('No primary model in config.models.');
    }
    this.primaryModel = primaryEntry.model;
    this.config = config;
    this.logger = createLogger(`agent/${config.id}`);
  }

  get working(): boolean {
    return this.abortController !== null;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  subscribe(channelId: string, callbacks: Callbacks): void {
    this.callbacks.set(channelId, [
      ...(this.callbacks.get(channelId) ?? []),
      callbacks,
    ]);
  }

  unsubscribe(channelId: string): void {
    this.callbacks.delete(channelId);
  }

  private getCallbacks(
    channelId: string,
    extraCallbacks?: Partial<Callbacks>
  ): Callbacks {
    if (channelId !== 'all' && !this.callbacks.has(channelId)) {
      throw new Error(`Channel "${channelId}" has not been subscribed to.`);
    }

    const channelCallbacks =
      channelId === 'all'
        ? Array.from(this.callbacks.values()).flat()
        : (this.callbacks.get(channelId) ?? []);

    return {
      onTurnStart: (prompt: PromptInput) => {
        channelCallbacks.forEach((callback) => callback.onTurnStart?.(prompt));
        extraCallbacks?.onTurnStart?.(prompt);
      },
      onContent: (chunk: string) => {
        channelCallbacks.forEach((callback) => callback.onContent?.(chunk));
        extraCallbacks?.onContent?.(chunk);
      },
      onThinking: (chunk: string) => {
        channelCallbacks.forEach((callback) => callback.onThinking?.(chunk));
        extraCallbacks?.onThinking?.(chunk);
      },
      onToolcall: (name: string, args: Record<string, unknown>) => {
        channelCallbacks.forEach((callback) =>
          callback.onToolcall?.(name, args)
        );
        extraCallbacks?.onToolcall?.(name, args);
      },
      onTurnDone: (messages?: AgentMessage[]) => {
        channelCallbacks.forEach((callback) => callback.onTurnDone?.(messages));
        extraCallbacks?.onTurnDone?.(messages);
      },
      onTurnStop: () => {
        channelCallbacks.forEach((callback) => callback.onTurnStop?.());
        extraCallbacks?.onTurnStop?.();
      },
      onError: (error: string) => {
        channelCallbacks.forEach((callback) => callback.onError?.(error));
        extraCallbacks?.onError?.(error);
      },
    };
  }

  async prompt(
    input: PromptInput,
    options: {
      channelId: string | null;
      callbacks?: Partial<Callbacks>;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    const callbacks =
      options.channelId === null
        ? {}
        : this.getCallbacks(options.channelId, options.callbacks);

    switch (options.channelId) {
      case 'all':
        this.logger.info('Prompting all channels...');
        break;
      case null:
        this.logger.info('Prompting no channels...');
        break;
      default:
        this.logger.info(`Prompting channel "${options.channelId}"...`);
        break;
    }

    const parsed = parseCommands({
      content: input.content,
      currentModel: this.core.state.model,
      primaryModel: this.primaryModel,
      config: this.config,
    });

    if (parsed.status === 'error') {
      callbacks.onError?.(parsed.message);
      return;
    }

    if (parsed.result.stopRequested) {
      if (this.abortController === null) {
        callbacks.onContent?.('Nothing to stop.');
        callbacks.onTurnDone?.();
        return;
      }

      this.abortController.abort();
      this.abortController = null;
      callbacks.onTurnDone?.();
      return;
    }

    if (parsed.result.helpRequested) {
      const commands = listCommands(this.config);
      callbacks.onContent?.(
        ['Available commands:', '', ...commands].join('\n')
      );
      callbacks.onTurnDone?.();
      return;
    }

    const model = parsed.result.model ?? this.primaryModel;
    const thinkingLevel = parsed.result.thinkingLevel ?? 'medium';

    if (parsed.result.statusRequested) {
      let contextLine: string;
      try {
        const contextTokens = deriveContextTokens(this.core.state.messages);
        const contextWindow = this.lastModel?.contextWindow ?? 0;
        const percentage =
          contextWindow > 0
            ? Math.min(100, (contextTokens / contextWindow) * 100).toFixed(1)
            : '0.0';
        contextLine = `📊 ${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${percentage}%)`;
      } catch {
        contextLine = '📊 Tokens: unknown';
      }
      callbacks.onContent?.(
        [
          'Status:',
          `🧠 Model: ${this.lastModel ? this.lastModel.name : 'nothing sent yet'}`,
          `💭 Thinking: ${thinkingLevel}`,
          contextLine,
          `🕵️‍♂️ Busy: ${this.abortController ? 'Yes (send /stop to stop)' : 'No. Ready for a new task.'}`,
          `\nOptions given for this prompt:`,
          `- Model: ${model.name}`,
          `- Thinking: ${thinkingLevel}`,
        ]
          .filter(Boolean)
          .join('\n')
      );
      callbacks.onTurnDone?.();
      return;
    }

    const images = input.images;
    const imageContents: ImageContent[] = images.map((img) => ({
      type: 'image' as const,
      data: img.data,
      mimeType: img.mimeType,
    }));

    if (this.core.state.isStreaming) {
      this.core.followUp({
        role: 'user',
        content: [
          ...imageContents,
          {
            type: 'text',
            text: input.content,
          },
        ],
        timestamp: Date.now(),
      });
      callbacks.onTurnDone?.();
      return;
    }

    this.abortController = new AbortController();

    if (options.signal?.aborted) {
      this.abortController.abort();
      this.abortController = null;
      callbacks.onTurnStop?.();
      return;
    }

    options.signal?.addEventListener(
      'abort',
      () => {
        this.abortController?.abort();
      },
      { once: true }
    );

    this.core.setModel(model);
    this.lastModel = model;
    this.core.setThinkingLevel(thinkingLevel);

    const nowIso = new Date().toISOString();
    const messageWithMeta = `Date and time is ${formatDate(
      nowIso
    )}. User sent this prompt: "${parsed.cleanPrompt}"`;

    this.logger.info(`\n"${messageWithMeta}"`);

    const modelLabel = this.core.state.model.name;
    this.logger.info(`Using ${modelLabel}.`);

    const unsubscribe = this.core.subscribe((event) => {
      switch (event.type) {
        case 'message_update':
          if (
            event.assistantMessageEvent.type === 'text_delta' &&
            event.assistantMessageEvent.delta.trim() !== ''
          ) {
            callbacks.onContent?.(event.assistantMessageEvent.delta);
          } else if (event.assistantMessageEvent.type === 'thinking_delta') {
            callbacks.onThinking?.(event.assistantMessageEvent.delta);
          }
          break;
        case 'tool_execution_start':
          callbacks.onToolcall?.(
            event.toolName,
            (event as { args?: Record<string, unknown> }).args ?? {}
          );
          this.logger.info(
            `[${event.toolName}(${JSON.stringify((event as { args?: unknown }).args)})]`
          );
          break;
        case 'tool_execution_end':
          this.logger.info(JSON.stringify(event.result));
          callbacks.onToolcallResult?.(
            event.toolName,
            JSON.stringify(event.result)
          );
          break;
        case 'agent_end':
          this.logger.info('Done.\n');
          callbacks.onTurnDone?.(event.messages);
          break;
        default:
          break;
      }
    });

    const signal = this.abortController.signal;
    const previousMessages = this.core.state.messages.slice();
    const abortState: { current: boolean } = { current: false };

    if (signal.aborted) {
      this.core.abort();
      callbacks.onTurnStop?.();
      return;
    }

    signal.addEventListener(
      'abort',
      () => {
        abortState.current = true;
        this.core.abort();
        callbacks.onTurnStop?.();
      },
      { once: true }
    );

    callbacks.onTurnStart?.(input);

    try {
      await this.core.prompt(messageWithMeta, imageContents);

      if (this.core.state.error) {
        const isPrimaryModel =
          this.core.state.model.id === this.primaryModel.id &&
          this.core.state.model.provider === this.primaryModel.provider;

        if (
          isPrimaryModel &&
          (this.core.state.error.includes('overloaded') ||
            this.core.state.error.includes('rate') ||
            this.core.state.error.includes('capacity'))
        ) {
          const fallbackModel =
            this.config.models.find((model) => model.role === 'fallback')
              ?.model ?? null;

          if (!fallbackModel) {
            callbacks.onError?.(this.core.state.error);
            this.logger.warn('No fallback model found in config.models.');
            return;
          }

          this.logger.warn(
            `${modelLabel} is overloaded. Trying again with ${fallbackModel.name}.`
          );

          this.core.setModel(fallbackModel);
          this.core.replaceMessages(this.core.state.messages.slice(0, -1));

          await this.core.continue();
        } else {
          callbacks.onError?.(this.core.state.error);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lowerMessage = message.toLowerCase();
      const isAbortLikeError =
        abortState.current ||
        (err instanceof Error &&
          (err.name === 'AbortError' ||
            err.name === 'TimeoutError' ||
            lowerMessage.includes('aborted') ||
            lowerMessage.includes('canceled') ||
            lowerMessage.includes('timed out')));

      if (isAbortLikeError) {
        abortState.current = true;
      } else {
        callbacks.onError?.(message);
      }
    } finally {
      if (abortState.current) {
        this.core.replaceMessages(previousMessages);
      }
      this.abortController = null;
      unsubscribe();
    }
  }

  static async create({
    config,
    messages,
    onCompact,
    getSystemPrompt = getDefaultSystemPrompt,
  }: AgentOptions): Promise<Agent> {
    const logger = createLogger(`agent/${config.id}`);
    const conversationStartIso = new Date().toISOString();
    const agentHolder: { current: Agent | null } = { current: null };
    const tools = await getTools(conversationStartIso, {
      config,
      onBackgroundUpdate: (update) => {
        logger.info(`[Background update] Prompting: "${update.message}"`);
        const agent = agentHolder.current;
        if (agent !== null) {
          void agent
            .prompt(
              {
                content: `[Update from background tool ${update.tool}]: "${update.message}"`,
                images: [],
              },
              { channelId: 'all' }
            )
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`Background update prompt failed: ${msg}`);
            });
        }
      },
    });

    const primaryEntry = config.models.find(
      (model) => model.role === 'primary'
    );
    if (!primaryEntry) {
      throw new Error('No primary model in config.models.');
    }
    const primaryModel = primaryEntry.model;

    const systemPrompt = getSystemPrompt(tools.instructions, config);

    const core = new CoreAgent({
      initialState: {
        systemPrompt,
        model: primaryModel,
        thinkingLevel: 'medium',
        tools: tools.tools,
        messages,
      },
      getApiKey(provider) {
        const key =
          config.models.find((model) => model.model.provider === provider)
            ?.key ?? null;
        if (!key) {
          throw new Error(
            `No API key found for provider "${provider}" in config.models.`
          );
        }
        return key;
      },
      transformContext: async (messages, signal) => {
        const { messages: newMessages, didCompact } = await compactContext(
          messages,
          signal,
          config
        );

        if (didCompact) {
          core.replaceMessages(newMessages);
          await onCompact?.(newMessages);
        }

        return newMessages;
      },
    });

    const agent = new Agent(core, config);
    agentHolder.current = agent;
    return agent;
  }
}

function getDefaultSystemPrompt(
  toolInstructions: string,
  config: AgentConfig
): string {
  return `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers.
You have control over my computer through several tools and skills.

You must never make up or assume facts, behaviors, or code. If you are missing information, unsure, or something is ambiguous, either ask me a concise clarifying question or explicitly say that you do not know or cannot determine the answer. Prefer using your tools and reading from the actual environment over guessing, and do not rely on later corrections from me.

${toolInstructions}

## Channel and delivery hints
Prompts may include explicit hints about how or where a message was sent (for example, markers such as "[Message was sent from Telegram]"). When such a hint is present, do not redundantly state that you sent or will send a message on that same channel (for example avoid phrases like "I replied via voice on Telegram" or "Sent you a message on Telegram" when the context already implies it). Prefer concise confirmations of the content or result instead of restating the delivery channel.

## Environment
- The code you're running on is at: ${process.cwd()}.
- Your workspace is at: ${getWorkspacePath(config)}. This is where you store your memory and notes.

### Error reporting
If any tool call returns an error, always explicitly tell the user:
- What tool/command failed
- What the error was

Do not silently skip, retry without mentioning it, or paper over failures.

### Restarting yourself
If you ever need to fully restart yourself (for example after configuration changes or if you are stuck), you can call the \`exec\` tool with the command \`greg gateway restart\`. Before doing so, you MUST: (1) call \`memory_note\` with a concise summary of the current conversation so you can later reload it and know where you left off, (2) tell the user explicitly that you are about to restart, then (3) run the restart command.

### Logs
Your logs are available through \`greg gateway logs\`. Run \`greg gateway logs --lines <number>\` to see the last <number> lines.
`;
}
