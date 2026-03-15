import { join, dirname, basename } from 'node:path';
import { getAllowlistForCommand } from './allowlist';
import { saveAlwaysAllowPreferenceForCommand } from './allowlist';
import type { ToolContext } from '../../../types';
import {
  parseCommand,
  type ParsedCommand,
} from './command-parser/command-parser';
import { state as gatewayState } from '../../../../gateway/gateway';

type PolicyEvaluation = {
  allowed: boolean;
  reason: string | null;
};

export async function evaluatePolicy(
  toolName: string,
  args: Object,
  context: ToolContext
): Promise<PolicyEvaluation> {
  if (!context.config.tools?.guard?.enabled) {
    return {
      allowed: true,
      reason: null,
    };
  }

  switch (toolName) {
    case 'exec':
      return evaluateExecPolicy(args as { command: string }, context);
    default:
      return {
        allowed: true,
        reason: null,
      };
  }
}

async function evaluateExecPolicy(
  { command }: { command: string },
  { config }: ToolContext
): Promise<PolicyEvaluation> {
  const parsedCommand = parseCommand(command);
  const pathSafeResult = evaluatePathSafety(parsedCommand);

  if (!pathSafeResult.safe) {
    return {
      allowed: false,
      reason: pathSafeResult.reason,
    };
  }

  const options = getAllowlistForCommand(command, config);

  if (!options.allow) {
    if (!gatewayState.getReply) {
      return {
        allowed: false,
        reason: 'No getReply() handler registered',
      };
    }

    const message = `💂 Greg is asking to run a command.
\`\`\`\n${command}\n\`\`\`\
\n
/deny - deny Greg to run this command
/once - allow Greg to run this command this time
/always - allow Greg to run this command always`;

    const reply = await gatewayState.getReply(message);

    if (reply !== '/once' && reply !== '/always' && reply !== `/always_cmd`) {
      const reason = `Command not allowed: ${command}. Permission was denied by the user. User replied: "${reply}".`;
      return {
        allowed: false,
        reason,
      };
    }

    if (reply === '/always') {
      await saveAlwaysAllowPreferenceForCommand(command, config);
    }

    return {
      allowed: true,
      reason: `Command allowed. Permission was granted by the user. User replied: "${reply}".`,
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

function evaluatePathSafety(command: ParsedCommand):
  | {
      safe: true;
      reason: null;
    }
  | {
      safe: false;
      reason: string;
    } {
  return {
    safe: true,
    reason: null,
  };
}
