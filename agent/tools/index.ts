import { tools as browserTools } from './browser';
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

When a user request matches an available skill, read that skill's full content from its <location> (e.g. with the terminal: cat "<location>") and follow the instructions. When you learn something new worth reusing (a workflow, rule, or capability), save it with save_skill.
`;
}
