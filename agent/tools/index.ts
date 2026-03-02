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

export const tools: AgentTool[] = [
  ...execTools,
  ...browserTools,
  ...memoryTools,
  ...skillTools,
];

export function getInstructions(conversationStartIso: string): string {
  return `
${getMemoryInstructions(conversationStartIso)}

${getSkillsInstructions()}

${browserInstructions}
`;
}
