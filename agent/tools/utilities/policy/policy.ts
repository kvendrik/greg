import { getAllowlistForCommand, getAllowlist } from './allowlist';
import { saveAlwaysAllowPreferenceForCommand } from './allowlist';
import type { ToolContext } from '../../../types';
import {
  parseCommand,
  type ParsedCommand,
} from '../command-parser/command-parser';
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
  if (context.config.tools?.guard.enabled === false) {
    return {
      allowed: true,
      reason: null,
    };
  }

  switch (toolName) {
    case 'exec':
      return evaluateExecPolicy(args as { command: ParsedCommand }, context);
    default:
      return {
        allowed: true,
        reason: null,
      };
  }
}

async function evaluateExecPolicy(
  { command }: { command: ParsedCommand },
  { config }: ToolContext
): Promise<PolicyEvaluation> {
  const pathSafeResult = evaluatePathSafety(command);

  if (!pathSafeResult.safe) {
    return {
      allowed: false,
      reason: pathSafeResult.reason,
    };
  }

  const options = getAllowlistForCommand(command.command, config);

  if (!options.allow) {
    if (config.tools?.guard?.exec?.askPermission === true) {
      if (!gatewayState.getReply) {
        return {
          allowed: false,
          reason: 'No getReply() handler registered',
        };
      }

      const message = `💂 ${config.id} is asking to run a command.
\`\`\`\n${command}\n\`\`\`\
\n
/deny - deny to run this command
/once - allow to run this command this time
/always - allow to always run this command`;

      const reply = await gatewayState.getReply(message);

      if (reply !== '/once' && reply !== '/always' && reply !== `/always_cmd`) {
        const reason = `Command not allowed: ${command.command}. Permission was denied by the user. User replied: "${reply}".`;
        return {
          allowed: false,
          reason,
        };
      }

      if (reply === '/always') {
        await saveAlwaysAllowPreferenceForCommand(command.command, config);
      }

      return {
        allowed: true,
        reason: `Command allowed. Permission was granted by the user. User replied: "${reply}".`,
      };
    }

    return {
      allowed: false,
      reason: `Command not allowed: \`${command.command}\`. Allowed commands: ${Object.keys(getAllowlist(config)).join(', ') || 'none'}.`,
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
