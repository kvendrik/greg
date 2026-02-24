import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { createExecTool } from './terminal';
import {
  get as getBrowserTools,
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

export async function get(signal: AbortSignal): Promise<BetaRunnableTool[]> {
  const browserTools = await getBrowserTools(signal);
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

${browserInstructions}
`;
}
