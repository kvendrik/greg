import {
  tools as browserTools,
  instructions as browserInstructions,
} from './browser';
import { runTerminalCommandTool } from './terminal';
import { tools as memoryTools } from './memory';
import { tools as skillTools } from './skills';
import { getSystemInstructions } from './memory';
import { getAvailableSkillsPrompt } from './skills';

export const tools = [
  runTerminalCommandTool,
  ...browserTools,
  ...memoryTools,
  ...skillTools,
];

/** Build tool instructions with an optional conversation start ISO (used when starting a thread). */
export function getInstructions(conversationStartIso: string): string {
  return `
${getSystemInstructions(conversationStartIso)}

${getAvailableSkillsPrompt()}

${browserInstructions}
`;
}
