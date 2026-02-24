import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { createExecTool } from './terminal';
import {
  tools as memoryTools,
  getInstructions as getMemoryInstructions,
} from './memory';
import {
  tools as skillTools,
  getInstructions as getSkillsInstructions,
} from './skills';

export function get(signal?: AbortSignal): BetaRunnableTool[] {
  return [createExecTool(signal), ...memoryTools, ...skillTools];
}

export function getInstructions(conversationStartIso: string): string {
  return `
${getMemoryInstructions(conversationStartIso)}

${getSkillsInstructions()}
`;
}
