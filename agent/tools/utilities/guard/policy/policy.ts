import type { AgentConfig } from '../../../../types';
import { getAllowlistForCommand } from './allowlist';
import { saveAlwaysAllowPreferenceForCommand } from './allowlist';
import type { ToolContext } from '../../../../types';
import { parseCommand } from './command-parser/command-parser';
import { sendMessage } from '../../../../../clients/telegram/utilities';

type PolicyEvaluation =
  | {
      allowed: true;
      reason: null;
    }
  | {
      allowed: false;
      reason: string;
    };

export async function evaluatePolicy(
  toolName: string,
  args: Object,
  context: ToolContext
): Promise<PolicyEvaluation> {
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
  const options = getAllowlistForCommand(command, config);

  if (config.tools.guard?.enabled && !options.allow) {
    const firstCommand = parsedCommand.segments[0].commandWithSubcommands!;

    const message = `💂 Greg is asking to run a command.
\`\`\`\n${command}\n\`\`\`\
\n
/deny - deny Greg to run this command
/once - allow Greg to run this command this time
/always - allow Greg to run this command always${parsedCommand.segments.length === 1 ? `\n/always_cmd - always allow Greg to run "${firstCommand}"` : ''}`;

    const reply = await sendMessage(message, {
      awaitReply: true,
      voice: false,
    });

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

    if (reply === `/always_cmd`) {
      await saveAlwaysAllowPreferenceForCommand(firstCommand, config);
    }
  }

  return {
    allowed: true,
    reason: null,
  };
}
