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

When a user request matches an available skill, read that skill's full content from its <location> (e.g. with the terminal: cat "<location>") and follow the instructions.

When you learn or establish something reusable (workflow, rule, convention, or capability), you must call save_skill before considering the exchange complete. Examples: a new CLI or editor workflow, a project convention, a preference for how to do X, or any instruction you give that the user might want applied again. If in doubt, save it as a skill.

Before ending your response: consider calling save_conversation_note (for what was discussed), update_user_memory (if they shared something about themselves), and/or save_skill (if something reusable was learned or established).
`;
}
