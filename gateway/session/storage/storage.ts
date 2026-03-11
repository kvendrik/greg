import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolResultMessage,
  Usage,
} from '@mariozechner/pi-ai';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import config from '../../../.greg';
import { getWorkspacePath } from '../../../agent/utilities';
import type { Agent, PromptInput, Callbacks } from '../../../agent';

export type StorageTools = {
  add: (content: string) => void;
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
};

type BufferedAssistant = {
  thinking: string;
  content: string;
  stopReason: StopReason;
  errorMessage?: string;
};

export function load(sessionId: string): StorageTools {
  const sessionsDir = path.join(getWorkspacePath(config), 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);

  let currentTurnId: string | null = null;
  let bufferedAssistant: BufferedAssistant | null = null;

  appendUserMessage(
    `[session-start] id=${sessionId} cwd=${getWorkspacePath(config)}`
  );

  return {
    add: (content: string) => {
      appendUserMessage(content);
    },
    proxy: (callbacks: Callbacks, agent: Agent): Callbacks => {
      const {
        onTurnStart,
        onThinking,
        onContent,
        onToolcall,
        onToolcallResult,
        onTurnDone,
        onTurnStop,
        onError,
      } = Object.entries(callbacks).reduce(
        (acc, [key, callback]) => ({
          ...acc,
          [key]: callback?.bind(agent),
        }),
        {} as Callbacks
      );

      return {
        onTurnStart: (input: PromptInput) => {
          currentTurnId = randomUUID();
          bufferedAssistant = null;

          appendUserMessage(input.content);

          onTurnStart?.(input);
        },
        onThinking: (content: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          const buf = getOrCreateBufferedAssistant('stop');
          buf.thinking += content;

          onThinking?.(content);
        },
        onContent: (content: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          const buf = getOrCreateBufferedAssistant('stop');
          buf.content += content;

          onContent?.(content);
        },
        onToolcall: (name: string, args: Record<string, unknown>) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          // We do not persist tool call start events, only results.
          onToolcall?.(name, args);
        },
        onToolcallResult: (name: string, result: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }

          const toolResult: ToolResultMessage = {
            role: 'toolResult',
            toolCallId: currentTurnId,
            toolName: name,
            content: [
              {
                type: 'text',
                text: result,
              } satisfies TextContent,
            ],
            isError: false,
            timestamp: Date.now(),
          };

          append(toolResult);

          onToolcallResult?.(name, result);
        },
        onTurnDone: () => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }

          if (bufferedAssistant) {
            bufferedAssistant.stopReason = 'stop';
            appendAssistantMessage(bufferedAssistant);
            bufferedAssistant = null;
          }

          onTurnDone?.();
        },
        onTurnStop: () => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }

          if (bufferedAssistant) {
            bufferedAssistant.stopReason = 'aborted';
            appendAssistantMessage(bufferedAssistant);
            bufferedAssistant = null;
          }

          onTurnStop?.();
        },
        onError: (error: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }

          if (!bufferedAssistant) {
            bufferedAssistant = {
              thinking: '',
              content: '',
              stopReason: 'error',
              errorMessage: error,
            };
          } else {
            bufferedAssistant.stopReason = 'error';
            bufferedAssistant.errorMessage = error;
          }

          appendAssistantMessage(bufferedAssistant);
          bufferedAssistant = null;

          onError?.(error);
        },
      };
    },
  };

  function append(entry: AgentMessage): void {
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(sessionPath, line, 'utf8');
  }

  function appendUserMessage(content: string): void {
    const userMessage: AgentMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    append(userMessage);
  }

  function getOrCreateBufferedAssistant(
    stopReason: StopReason
  ): BufferedAssistant {
    if (!bufferedAssistant) {
      bufferedAssistant = {
        thinking: '',
        content: '',
        stopReason,
      };
    }
    return bufferedAssistant;
  }

  function appendAssistantMessage(buffer: BufferedAssistant): void {
    const content: (TextContent | ThinkingContent)[] = [];

    if (buffer.thinking) {
      content.push({
        type: 'thinking',
        thinking: buffer.thinking,
      });
    }

    if (buffer.content) {
      content.push({
        type: 'text',
        text: buffer.content,
      });
    }

    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content,
      api: 'openai-completions',
      provider: 'openai',
      model: 'unknown',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: buffer.stopReason,
      errorMessage: buffer.errorMessage,
      timestamp: Date.now(),
    };

    append(assistantMessage);
  }
}
