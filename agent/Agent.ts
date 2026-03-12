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
import pc from 'picocolors';
import { createUUID } from '../gateway/sessions/utilities';

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

interface AgentOptions extends ToolContext {
  messages: AgentMessage[];
}

export class Agent {
  private abortController: AbortController | null = null;
  private core: CoreAgent;
  private lastModel: Model<Api> | null = null;
  private readonly primaryModel: Model<Api>;
  private readonly config: AgentConfig;
  private callbacks: Map<string, Callbacks> = new Map();

  private constructor(core: CoreAgent, config: AgentConfig) {
    this.core = core;
    this.primaryModel = config.models.find(
      (model) => model.role === 'primary'
    )!.model;
    this.config = config;
  }

  get working(): boolean {
    return this.abortController !== null;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  subscribe(callbacks: Callbacks): string {
    const id = createUUID();
    this.callbacks.set(id, callbacks);
    return id;
  }

  private getCallbacks(): Callbacks {
    const callbacks = Array.from(this.callbacks.values());
    return {
      onTurnStart: (prompt: PromptInput) => {
        callbacks.forEach((callback) => callback.onTurnStart?.(prompt));
      },
      onContent: (chunk: string) => {
        callbacks.forEach((callback) => callback.onContent?.(chunk));
      },
      onThinking: (chunk: string) => {
        callbacks.forEach((callback) => callback.onThinking?.(chunk));
      },
      onToolcall: (name: string, args: Record<string, unknown>) => {
        callbacks.forEach((callback) => callback.onToolcall?.(name, args));
      },
      onTurnDone: (messages?: AgentMessage[]) => {
        callbacks.forEach((callback) => callback.onTurnDone?.(messages));
      },
      onTurnStop: () => {
        callbacks.forEach((callback) => callback.onTurnStop?.());
      },
      onError: (error: string) => {
        callbacks.forEach((callback) => callback.onError?.(error));
      },
    };
  }

  async prompt(input: PromptInput): Promise<void> {
    const callbacks = this.getCallbacks();

    const parsed = parseCommands({
      content: input.content,
      currentModel: this.core.state.model ?? this.primaryModel,
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
          `🕵️‍♂️ Busy: ${!this.abortController ? 'Yes (send /stop to stop)' : 'No. Ready for a new task.'}`,
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

    const images = input.images ?? [];
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

    this.core.setModel(model);
    this.lastModel = model;
    this.core.setThinkingLevel(thinkingLevel);

    const nowIso = new Date().toISOString();
    const messageWithMeta = `Date and time is ${formatDate(
      nowIso
    )}. User sent this prompt: "${parsed.cleanPrompt}"`;

    console.info(pc.gray(`\n"${messageWithMeta}"`));

    const modelLabel = this.core.state.model?.name;
    console.info(pc.gray(`Using ${modelLabel}.`));

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
          console.info(
            pc.cyan(
              `[${event.toolName}(${JSON.stringify((event as { args?: unknown }).args)})]`
            )
          );
          break;
        case 'tool_execution_end':
          console.info(pc.gray(JSON.stringify(event.result)));
          callbacks.onToolcallResult?.(
            event.toolName,
            JSON.stringify(event.result)
          );
          break;
        case 'agent_end':
          console.info(pc.green('Done.\n'));
          callbacks.onTurnDone?.(event.messages);
          break;
        default:
          break;
      }
    });

    const signal = this.abortController.signal;
    const previousMessages = this.core.state.messages.slice();
    let aborted = false;

    if (signal?.aborted) {
      aborted = true;
      this.core.abort();
      callbacks.onTurnStop?.();
      return;
    }

    signal?.addEventListener(
      'abort',
      () => {
        aborted = true;
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
          this.core.state.model?.id === this.primaryModel.id &&
          this.core.state.model?.provider === this.primaryModel.provider;

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
            callbacks.onError?.(`No fallback model found in config.models.`);
            return;
          }

          console.info(
            pc.yellow(
              `${modelLabel} is overloaded. Trying again with ${fallbackModel.name}.`
            )
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
        aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' ||
            err.name === 'TimeoutError' ||
            lowerMessage.includes('aborted') ||
            lowerMessage.includes('canceled') ||
            (signal?.aborted && lowerMessage.includes('timed out'))));

      if (isAbortLikeError) {
        aborted = true;
      } else {
        callbacks.onError?.(message);
      }
    } finally {
      if (aborted) {
        this.core.replaceMessages(previousMessages);
      }
      this.abortController = null;
      unsubscribe();
    }
  }

  static async create({ config, messages }: AgentOptions): Promise<Agent> {
    const conversationStartIso = new Date().toISOString();
    const tools = await getTools(conversationStartIso, { config });

    const primaryModel = config.models.find(
      (model) => model.role === 'primary'
    )!.model;

    const core = new CoreAgent({
      initialState: {
        systemPrompt: getSystemPrompt(tools.instructions, config),
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
      transformContext: (messages, signal) =>
        compactContext(messages, signal, config),
    });

    return new Agent(core, config);
  }
}

function getSystemPrompt(
  toolInstructions: string,
  config: AgentConfig
): string {
  return `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers.
You have control over my computer through several tools and skills.

You must never make up or assume facts, behaviors, or code. If you are missing information, unsure, or something is ambiguous, either ask me a concise clarifying question or explicitly say that you do not know or cannot determine the answer. Prefer using your tools and reading from the actual environment over guessing, and do not rely on later corrections from me.

${toolInstructions}

## Environment
- The code you're running on is at: ${process.cwd()}.
- Your workspace is at: ${getWorkspacePath(config)}. This is where you store your memory and notes.

### Error reporting
If any tool call returns an error, always explicitly tell the user:
- What tool/command failed
- What the error was

Do not silently skip, retry without mentioning it, or paper over failures.

### Restarting yourself
If you ever need to fully restart yourself (for example after configuration changes or if you are stuck), you can call the \`exec\` tool with the command \`greg restart\`. Before doing so, you MUST: (1) call \`memory_note\` with a concise summary of the current conversation so you can later reload it and know where you left off, (2) tell the user explicitly that you are about to restart, then (3) run the restart command.

### Logs
Your logs are available through \`greg logs\`. Run \`greg logs --lines <number>\` to see the last <number> lines.
`;
}
