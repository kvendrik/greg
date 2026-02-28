import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import {
  create as createBrowserTool,
  instructions as browserInstructions,
} from './browser';
import {
  tools as memoryTools,
  getInstructions as getMemoryInstructions,
} from './memory';
import {
  tools as skillTools,
  getInstructions as getSkillsInstructions,
} from './skills';
import { createExecTool } from './terminal';

export async function get(signal: AbortSignal): Promise<BetaRunnableTool[]> {
  return [
    createExecTool(signal),
    createBrowserTool(signal),
    ...memoryTools,
    ...skillTools,
  ];
}

export function getInstructions(conversationStartIso: string): string {
  return `
${getMemoryInstructions(conversationStartIso)}

${getSkillsInstructions()}

${browserInstructions}
`;
}
