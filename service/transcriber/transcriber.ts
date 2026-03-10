import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import config from '../../.greg';
import { getWorkspacePath } from '../Agent/utilities';
import type { Agent, PromptInput, Callbacks } from '../Agent/Agent';

export type Transcripter = {
  add: (content: string) => void;
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
};

type BaseEntry = {
  sessionId: string;
  time: string;
};

type JsonlEntry =
  | (BaseEntry & { type: 'session_start' })
  | (BaseEntry & { type: 'user'; turnId: string; content: string })
  | (BaseEntry & { type: 'assistant_start'; turnId: string })
  | (BaseEntry & {
      type: 'thinking' | 'content';
      turnId: string;
      content: string;
    })
  | (BaseEntry & {
      type: 'tool_call';
      turnId: string;
      name: string;
      args: Record<string, unknown>;
    })
  | (BaseEntry & {
      type: 'tool_result';
      turnId: string;
      name: string;
      result: string;
    })
  | (BaseEntry & {
      type: 'assistant_end';
      turnId: string;
      status: 'done' | 'stopped' | 'error';
      error?: string;
    })
  | (BaseEntry & { type: 'raw'; content: string });

export function createTranscripter(sessionId: string): Transcripter {
  const transcriptsDir = path.join(getWorkspacePath(config), 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });

  const dateTime = new Intl.DateTimeFormat('en-GB', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(new Date())
    .replaceAll('/', '-')
    .replaceAll(':', '-')
    .replaceAll(', ', '_')
    .replaceAll(' ', '-');

  const transcriptPath = path.join(
    transcriptsDir,
    `${dateTime}_${sessionId}.jsonl`
  );

  let currentTurnId: string | null = null;
  let thinkingBuffer = '';
  let contentBuffer = '';

  append({
    type: 'session_start',
    sessionId,
    time: new Date().toISOString(),
  });

  return {
    add: (content: string) => {
      append({
        type: 'raw',
        sessionId,
        time: new Date().toISOString(),
        content,
      });
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
          const turnId = randomUUID();
          currentTurnId = turnId;
          const time = new Date().toISOString();

          append({
            type: 'user',
            sessionId,
            time,
            turnId,
            content: input.content,
          });

          append({
            type: 'assistant_start',
            sessionId,
            time,
            turnId,
          });

          onTurnStart?.(input);
        },
        onThinking: (content: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          thinkingBuffer += content;
          onThinking?.(content);
        },
        onContent: (content: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          contentBuffer += content;
          onContent?.(content);
        },
        onToolcall: (name: string, args: Record<string, unknown>) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          flushTextBuffers();
          append({
            type: 'tool_call',
            sessionId,
            time: new Date().toISOString(),
            turnId: currentTurnId,
            name,
            args,
          });
          onToolcall?.(name, args);
        },
        onToolcallResult: (name: string, result: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          flushTextBuffers();
          append({
            type: 'tool_result',
            sessionId,
            time: new Date().toISOString(),
            turnId: currentTurnId,
            name,
            result,
          });
          onToolcallResult?.(name, result);
        },
        onTurnDone: () => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          flushTextBuffers();
          append({
            type: 'assistant_end',
            sessionId,
            time: new Date().toISOString(),
            turnId: currentTurnId,
            status: 'done',
          });
          onTurnDone?.();
        },
        onTurnStop: () => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          flushTextBuffers();
          append({
            type: 'assistant_end',
            sessionId,
            time: new Date().toISOString(),
            turnId: currentTurnId,
            status: 'stopped',
          });
          onTurnStop?.();
        },
        onError: (error: string) => {
          if (!currentTurnId) {
            currentTurnId = randomUUID();
          }
          flushTextBuffers();
          append({
            type: 'assistant_end',
            sessionId,
            time: new Date().toISOString(),
            turnId: currentTurnId,
            status: 'error',
            error,
          });
          onError?.(error);
        },
      };
    },
  };

  function append(entry: JsonlEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(transcriptPath, line, 'utf8');
  }

  function flushTextBuffers(): void {
    if (!currentTurnId) {
      currentTurnId = randomUUID();
    }
    const time = new Date().toISOString();

    if (thinkingBuffer) {
      append({
        type: 'thinking',
        sessionId,
        time,
        turnId: currentTurnId,
        content: thinkingBuffer,
      });
      thinkingBuffer = '';
    }

    if (contentBuffer) {
      append({
        type: 'content',
        sessionId,
        time,
        turnId: currentTurnId,
        content: contentBuffer,
      });
      contentBuffer = '';
    }
  }
}

