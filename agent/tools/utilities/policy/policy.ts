import type { ToolContext } from '../../../types';
import { state as gatewayState } from '../../../../gateway/gateway';
import { evaluateExecPolicy, execPolicyToolNames } from '../../exec/index';
import {
  evaluateFilePolicy,
  toolNames as filePolicyToolNames,
  type ToolName as FileToolName,
} from '../../files/index';
import { prettify } from './prettify';

export type PolicyEvaluation = {
  allowed: boolean;
  reason: string | null;
};

export async function evaluatePolicy(
  call: { name: string; label: string; params: Record<string, unknown> },
  context: ToolContext
): Promise<PolicyEvaluation> {
  const { config } = context;

  if (!config.tools.guard.enabled) {
    return {
      allowed: true,
      reason: null,
    };
  }

  let result: PolicyEvaluation = { allowed: true, reason: null };

  if ((execPolicyToolNames as readonly string[]).includes(call.name)) {
    result = evaluateExecPolicy({
      toolName: call.name,
      params: call.params,
      context,
    });
  } else if (
    Object.values(filePolicyToolNames)
      .flat()
      .includes(call.name as FileToolName)
  ) {
    result = evaluateFilePolicy({
      toolName: call.name as FileToolName,
      params: call.params,
      context,
    });
  } else if (call.name === 'web_fetch') {
    result = {
      allowed: false,
      reason: null,
    };
  }

  if (!result.allowed && isToolTmpAllowed(call.name)) {
    return {
      allowed: true,
      reason: `Tool call allowed. Permission was previously granted by the user for ${call.name} to be ran for 5 minutes.`,
    };
  }

  if (!result.allowed && config.tools.guard.ask) {
    return ask();
  }

  return result;

  async function ask(): Promise<PolicyEvaluation> {
    if (!gatewayState.getReply) {
      return {
        allowed: false,
        reason:
          'Tool call not allowed. Could not ask for permission. No getReply() handler registered.',
      };
    }

    const prettyParams = prettify(call.params);
    const messageBody = `💂 ${config.id} is asking to run a tool:

\`\`\`js\n${call.name}(${prettyParams})\n\`\`\``;

    const commandsHint = `\n\n/deny <reason> - deny to run this command, optionally provide a reason\n/once - allow to run this command this time\n/5m - allow ${call.name}() for the next 5 minutes`;
    const message = messageBody + commandsHint;

    const reply = await gatewayState.getReply(message, {
      toolName: call.name,
      toolParams: call.params,
      prettyParams,
      commandsHint,
      commands: {
        once: 'allow to run this command this time',
        '5m': `allow ${call.name}() for the next 5 minutes`,
        deny: 'deny to run this command, optionally provide a reason',
      },
    });

    const cleanReply = reply.trim().toLowerCase();

    if (!cleanReply.startsWith('/once') && !cleanReply.startsWith('/5m')) {
      const reason = `Tool call not allowed.. Permission was denied by the user. User replied: "${reply}".`;
      return {
        allowed: false,
        reason,
      };
    }

    if (cleanReply.startsWith('/5m')) {
      const reason = `Tool calls to ${call.name} allowed for the next 5 minutes. Permission was granted by the user. User replied: "${reply}".`;
      tmpAllowedTools.set(call.name, new Date(Date.now() + 5 * 60 * 1000));
      return {
        allowed: true,
        reason,
      };
    }

    return {
      allowed: true,
      reason: `Tool call allowed. Permission was granted by the user. User replied: "${reply}".`,
    };
  }
}

const tmpAllowedTools = new Map<string, Date>();

function isToolTmpAllowed(toolName: string): boolean {
  const now = new Date();
  const allowedUntil = tmpAllowedTools.get(toolName) ?? null;
  const isAllowed = Boolean(allowedUntil && allowedUntil > now);
  if (allowedUntil && !isAllowed) {
    tmpAllowedTools.delete(toolName);
  }
  return isAllowed;
}
