import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentConfig } from '../types';
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
  config: AgentConfig,
  options: {
    addToTranscript: (content: string) => void;
  }
): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const tools: AgentTool[] = [
    ...getExecTools(config, options),
    ...getBrowserTools(config),
    ...getWebTools(config),
    ...getMemoryTools(config),
    ...getSkillTools(config),
    ...getFilesTools(config),
  ];

  const instructions = `
  ${getMemoryInstructions(conversationStartIso, config)}
  
  ${getSkillsInstructions(config)}
  
  ${getBrowserInstructions()}
  `;

  return {
    tools,
    instructions,
  };
}
