import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { createBrowserTools } from './browser';
import { createExecTool } from './terminal';
import {
  tools as memoryTools,
  getInstructions as getMemoryInstructions,
} from './memory';
import {
  tools as skillTools,
  getInstructions as getSkillsInstructions,
} from './skills';

export async function get(signal: AbortSignal): Promise<BetaRunnableTool[]> {
  const browserTools = await createBrowserTools(signal);
  return [
    createExecTool(signal),
    ...memoryTools,
    ...skillTools,
    ...browserTools,
  ];
}

export function getInstructions(conversationStartIso: string): string {
  return `
${getMemoryInstructions(conversationStartIso)}

${getSkillsInstructions()}
`;
}
