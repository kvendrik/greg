import type { AgentTool } from '@mariozechner/pi-agent-core';
import {
  instructions as browserInstructions,
  tools as browserTools,
} from './browser';
import {
  getInstructions as getMemoryInstructions,
  tools as memoryTools,
} from './memory';
import {
  getInstructions as getSkillsInstructions,
  tools as skillTools,
} from './skills';
import { tools as execTools } from './exec';
import { tools as webTools } from './web';
import config from '../../.greg';

export async function get(conversationStartIso: string): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const tools: AgentTool[] = [
    ...execTools,
    ...browserTools,
    ...webTools,
    ...memoryTools,
    ...skillTools,
  ];

  const instructions = `
  ${getMemoryInstructions(conversationStartIso)}
  
  ${getSkillsInstructions()}
  
  ${browserInstructions}
  `;

  return {
    tools,
    instructions,
  };
}
