import type { ToolContext } from '../../../types';
import { state as gatewayState } from '../../../../gateway/gateway';
import {
  evaluateExecPolicy,
  execPolicyToolNames,
  type PolicyEvaluation,
} from '../../exec/index';
import { evaluateFilePolicy, filePolicyToolNames } from '../../files/index';
import { prettify } from './prettify';

export async function evaluatePolicy(
  call: { name: string; label: string; params: Record<string, unknown> },
  context: ToolContext
): Promise<PolicyEvaluation> {
  const { config } = context;

  if (config.tools?.guard.enabled === false) {
    return {
      allowed: true,
      reason: null,
    };
  }

  let result: PolicyEvaluation = { allowed: true, reason: null };

  if ((execPolicyToolNames as readonly string[]).includes(call.name)) {
    result = await evaluateExecPolicy({
      toolName: call.name,
      params: call.params,
      context,
    });
  } else if ((filePolicyToolNames as readonly string[]).includes(call.name)) {
    result = await evaluateFilePolicy({
      toolName: call.name,
      params: call.params,
      context,
    });
  }

  if (!result?.allowed && config.tools?.guard?.ask === true) {
    if (!gatewayState.getReply) {
      return {
        allowed: false,
        reason:
          'Tool call not allowed. Could not ask for permission. No getReply() handler registered.',
      };
    }

    const callString = prettify(call.name, call.params);

    const message = `💂 ${config.id} is asking to run a \`${call.label}\`:
\`\`\`\n${callString}\n\`\`\`\
\n
/deny <reason> - deny to run this command, optionally provide a reason
/once - allow to run this command this time`;

    const reply = await gatewayState.getReply(message);

    if (!reply.trim().toLowerCase().startsWith('/once')) {
      const reason = `Command not allowed: ${callString}. Permission was denied by the user. User replied: "${reply}".`;
      return {
        allowed: false,
        reason,
      };
    }

    return {
      allowed: true,
      reason: `Command allowed. Permission was granted by the user. User replied: "${reply}".`,
    };
  }

  return result;
}
