import { runTerminalCommandTool } from './terminal';
import {
  tools as memoryTools,
  getInstructions as getMemoryInstructions,
} from './memory';
import {
  tools as skillTools,
  getInstructions as getSkillsInstructions,
} from './skills';

export const tools = [runTerminalCommandTool, ...memoryTools, ...skillTools];

export function getInstructions(conversationStartIso: string): string {
  return `
${getMemoryInstructions(conversationStartIso)}

${getSkillsInstructions()}
`;
}
