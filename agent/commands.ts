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
  compact: {
    requested: boolean;
    instructions: string | null;
  };
  steer:
    | { requested: true; instructions: string }
    | { requested: false; instructions: null };
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

type CommandInfo = {
  command: string;
  description: string;
};

export function listCommands(config: Config): CommandInfo[] {
  const modelCommands = config.models
    .filter(
      (m): m is Config['models'][number] & { command: string } => 'command' in m
    )
    .map((m) => ({
      command: `/${m.command}`,
      description: `Switch to ${m.model.name}`,
    }));

  return [
    ...modelCommands,
    {
      command: '/status',
      description: 'Show the current session status',
    },
    {
      command: '/compact',
      description: 'Compact conversation history with optional instructions',
    },
    {
      command: '/think off',
      description: 'Disable extended reasoning',
    },
    {
      command: '/think low',
      description: 'Use a low amount of reasoning',
    },
    {
      command: '/think medium',
      description: 'Use a medium amount of reasoning',
    },
    {
      command: '/think high',
      description: 'Use a high amount of reasoning',
    },
    {
      command: '/stop',
      description: 'Stop the active response',
    },
    {
      command: '/steer',
      description:
        'Steer the conversation in a specific direction with instructions',
    },
    {
      command: '/help',
      description: 'Show available commands',
    },
  ];
}

export function parseCommands(input: ParseCommandsInput): ParseCommandsOutput {
  let content = input.content.trim();
  let model: ConfigModel | null = null;
  let thinkingLevel: ThinkingLevel | null = null;
  let statusRequested = false;
  let stopRequested = false;
  let helpRequested = false;

  const compact: ParseCommandsResult['compact'] = {
    requested: false,
    instructions: null,
  };

  let steer: ParseCommandsResult['steer'] = {
    requested: false,
    instructions: null,
  };

  if (!content.startsWith('/')) {
    return {
      status: 'success',
      result: {
        model: null,
        thinkingLevel: null,
        statusRequested: false,
        stopRequested: false,
        helpRequested: false,
        compact: {
          requested: false,
          instructions: null,
        },
        steer: {
          requested: false,
          instructions: null,
        },
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
      case 'compact': {
        compact.requested = true;
        compact.instructions = content;
        break;
      }
      case 'steer': {
        if (content === '') {
          return {
            status: 'error',
            message: `Compaction requested but no instructions provided.`,
          };
        }
        steer = {
          requested: true,
          instructions: content,
        };
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
          const available = listCommands(input.config)
            .map((c) => c.command)
            .join(', ');

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
      compact,
      steer,
    },
    cleanPrompt: content,
  };
}
