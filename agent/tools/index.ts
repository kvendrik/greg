import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { getBrowserInstructions, getBrowserTools } from './browser';
import { getExecTools } from './exec';
import { load as loadMemory } from './memory';
import {
  getInstructions as getSkillsInstructions,
  getTools as getSkillTools,
} from './skills';
import { getFilesTools } from './files';
import { createWebFetchTool } from './web-fetch';
import { createWebSearchTool } from './web-search';

export async function get(
  conversationStartIso: string,
  context: ToolContext
): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const deniedTools = context.config.tools?.deny ?? null;

  let tools: AgentTool[] = [
    ...getSkillTools(context),
    ...getFilesTools(context),
  ];

  let instructions = getSkillsInstructions(context.config);

  if (!deniedTools?.includes('memory')) {
    const memory = await loadMemory(context.config, conversationStartIso);
    tools.push(...memory.tools);
    instructions += memory.instructions;
  }

  if (!deniedTools?.includes('exec')) {
    tools.push(...getExecTools(context));
  }

  if (!deniedTools?.includes('browser_use')) {
    tools.push(...getBrowserTools(context));
    instructions += getBrowserInstructions();
  }

  if (!deniedTools?.includes('web_search')) {
    tools.push(createWebSearchTool(context));
  }

  if (!deniedTools?.includes('web_fetch')) {
    tools.push(createWebFetchTool(context));
  }

  return {
    tools,
    instructions,
  };
}
