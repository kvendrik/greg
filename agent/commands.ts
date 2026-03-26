import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { Config } from '../config';

type ConfigModel = Config['models'][number]['model'];

export type ParseCommandsInput = {
  content: string;
  currentModel: ConfigModel;
  config: Config;
};

export type ParseCommandsResult = {
  model: ConfigModel | null;
  thinkingLevel: ThinkingLevel | null;
  statusRequested: boolean;
  stopRequested: boolean;
  helpRequested: boolean;
};

export type ParseCommandsOutput =
  | { status: 'error'; message: string }
  | {
      status: 'success';
      result: ParseCommandsResult;
      cleanPrompt: string;
    };

/** Matches leading /command and optional trailing space only (no argument consumed). */
const COMMAND_REGEX = /^\/([^\s:]+)\s*/;
const THINK_LEVEL_REGEX = /^(off|low|medium|high)\s*/i;

export function listCommands(config: Config): string[] {
  const modelCommands = config.models
    .filter(
      (m): m is Config['models'][number] & { command: string } => 'command' in m
    )
    .map((m) => `/${m.command}`);

  return [
    ...modelCommands,
    '/status',
    '/think off',
    '/think low',
    '/think medium',
    '/think high',
    '/stop',
    '/help',
  ];
}

export function parseCommands(input: ParseCommandsInput): ParseCommandsOutput {
  let content = input.content.trim();
  let model: ConfigModel | null = null;
  let thinkingLevel: ThinkingLevel | null = null;
  let statusRequested = false;
  let stopRequested = false;
  let helpRequested = false;

  if (!content.startsWith('/')) {
    return {
      status: 'success',
      result: {
        model: null,
        thinkingLevel: null,
        statusRequested: false,
        stopRequested: false,
        helpRequested: false,
      },
      cleanPrompt: content,
    };
  }

  for (;;) {
    const match = COMMAND_REGEX.exec(content);
    if (!match) break;

    const cmd = match[1];
    const fullMatch = match[0];
    content = content.slice(fullMatch.length).trim();

    switch (cmd) {
      case 'status': {
        statusRequested = true;
        break;
      }
      case 'stop': {
        stopRequested = true;
        break;
      }
      case 'help': {
        helpRequested = true;
        break;
      }
      case 'think': {
        const levelMatch = THINK_LEVEL_REGEX.exec(content);
        if (!levelMatch) {
          return {
            status: 'error',
            message: `Unknown thinking level. Use: /think off, /think low, /think medium, /think high`,
          };
        }
        thinkingLevel = levelMatch[1].toLowerCase() as ThinkingLevel;
        content = content.slice(levelMatch[0].length).trim();
        break;
      }
      default: {
        const modelFromCommand =
          input.config.models.find(
            (m): m is Config['models'][number] & { command: string } =>
              'command' in m && m.command === cmd
          )?.model ?? null;
        if (!modelFromCommand) {
          const available = listCommands(input.config).join(', ');
          return {
            status: 'error',
            message: `Unknown command: "${cmd}". Available: ${available}`,
          };
        }
        model = modelFromCommand;
        break;
      }
    }
  }

  return {
    status: 'success',
    result: {
      model,
      thinkingLevel,
      statusRequested,
      stopRequested,
      helpRequested,
    },
    cleanPrompt: content,
  };
}
