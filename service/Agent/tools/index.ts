import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { getBrowserInstructions, getBrowserTools } from './browser';
import { getExecTools } from './exec';
import {
  getInstructions as getMemoryInstructions,
  getTools as getMemoryTools,
} from './memory';
import {
  getInstructions as getSkillsInstructions,
  getTools as getSkillTools,
} from './skills';
import { getFilesTools } from './files';
import { getWebTools } from './web';

export async function get(
  conversationStartIso: string,
  context: ToolContext
): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const tools: AgentTool[] = [
    ...getExecTools(context),
    ...getBrowserTools(context),
    ...getWebTools(context),
    ...getMemoryTools(context),
    ...getSkillTools(context),
    ...getFilesTools(context),
  ];

  const instructions = `
  ${getMemoryInstructions(conversationStartIso, context.config)}
  
  ${getSkillsInstructions(context.config)}
  
  ${getBrowserInstructions()}
  `;

  return {
    tools,
    instructions,
  };
}
