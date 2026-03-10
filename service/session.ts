import { randomUUID } from 'node:crypto';
import config from '../.greg';
import { Agent, type PromptInput, type Callbacks } from './Agent';
import { getWorkspacePath } from './Agent/utilities';
import path from 'node:path';
import fs from 'node:fs';

export type Session = {
  working: boolean;
  listen(callbacks: Callbacks): void;
  abort(): void;
  prompt(input: PromptInput): Promise<void>;
  id: string;
  delete(): void;
};

const sessions = new Map<string, Session>();

export async function create(): Promise<Session> {
  const sessionId = randomUUID();
  const transcripter = createTranscripter(sessionId);

  const agent = await Agent.create(config, {
    addToTranscript: transcripter.add,
  });

  const session: Session = {
    id: sessionId,
    get working() {
      return agent.working;
    },
    listen: (callbacks: Callbacks) => {
      agent.listen(transcripter.proxy(callbacks, agent));
    },
    abort: agent.abort.bind(agent),
    prompt: agent.prompt.bind(agent),
    delete() {
      agent.abort();
      sessions.delete(session.id);
    },
  };

  sessions.set(session.id, session);
  return session;
}

export function get(id: string): Session | null {
  return sessions.get(id) ?? null;
}

function createTranscripter(sessionId: string): {
  add: (content: string) => void;
  proxy: (callbacks: Callbacks, agent: Agent) => Callbacks;
} {
  fs.mkdirSync(path.join(getWorkspacePath(config), 'transcripts'), {
    recursive: true,
  });

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
    getWorkspacePath(config),
    'transcripts',
    `${dateTime}_${sessionId}.md`
  );

  let transcript = `<session id="${sessionId}" start-time="${new Date().toISOString()}" />`;

  return {
    add: (content: string) => {
      transcript += content;
      write();
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
          [key]: callback.bind(agent),
        }),
        {} as Callbacks
      );

      return {
        onTurnStart: (input: PromptInput) => {
          const runId = randomUUID();
          const time = new Date().toISOString();

          transcript += `<user time="${time}" run-id="${runId}">`;
          transcript += input.content;
          transcript += `</user>`;

          transcript += `<assistant time="${time}" run-id="${runId}">`;

          onTurnStart?.(input);
        },
        onThinking: (content: string) => {
          transcript += content;
          onThinking?.(content);
        },
        onContent: (content: string) => {
          transcript += content;
          onContent?.(content);
        },
        onToolcall: (name: string, args: Record<string, unknown>) => {
          transcript += `<tool_call name="${name}" arguments="${JSON.stringify(args).replaceAll('"', "'")}">`;
          onToolcall?.(name, args);
          write();
        },
        onToolcallResult: (name: string, result: string) => {
          transcript += `${result}`;
          transcript += `</tool_call>`;
          onToolcallResult?.(name, result);
          write();
        },
        onTurnDone: () => {
          transcript += `</assistant>`;
          onTurnDone?.();
          write();
        },
        onTurnStop: () => {
          transcript += `<update status="stopped" time="${new Date().toISOString()}" />`;
          transcript += `</assistant>`;
          onTurnStop?.();
          write();
        },
        onError: (error: string) => {
          transcript += `<update status="error" time="${new Date().toISOString()}">${error}</error>`;
          transcript += `</assistant>`;
          onError?.(error);
          write();
        },
      };
    },
  };

  function write() {
    const existingTranscript = fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, 'utf8')
      : '';
    fs.writeFileSync(transcriptPath, existingTranscript + transcript);
    transcript = '';
  }
}
