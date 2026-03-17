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
import { createSpawnTools } from './spawn';

export async function get(
  conversationStartIso: string,
  context: ToolContext
): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const deniedTools = context.config.tools?.deny ?? null;
  const allowedTools = context.config.tools?.allow ?? [
    'skills',
    'files',
    'memory',
    'exec',
    'browser_use',
    'web_search',
    'web_fetch',
    'subagents',
  ];

  let tools: AgentTool[] = [];
  let instructions = getSkillsInstructions(context.config);

  if (!deniedTools?.includes('skills') && allowedTools.includes('skills')) {
    tools.push(...getSkillTools(context));
  }

  if (!deniedTools?.includes('files') && allowedTools.includes('files')) {
    tools.push(...getFilesTools(context));
  }

  if (!deniedTools?.includes('memory') && allowedTools.includes('memory')) {
    const memory = await loadMemory(context.config, conversationStartIso);
    tools.push(...memory.tools);
    instructions += memory.instructions;
  }

  if (!deniedTools?.includes('exec') && allowedTools.includes('exec')) {
    tools.push(...getExecTools(context));
  }

  if (
    !deniedTools?.includes('browser_use') &&
    allowedTools.includes('browser_use')
  ) {
    tools.push(...getBrowserTools(context));
    instructions += getBrowserInstructions();
  }

  if (
    !deniedTools?.includes('web_search') &&
    allowedTools.includes('web_search')
  ) {
    tools.push(createWebSearchTool(context));
  }

  if (
    !deniedTools?.includes('web_fetch') &&
    allowedTools.includes('web_fetch')
  ) {
    tools.push(createWebFetchTool(context));
  }

  if (
    !deniedTools?.includes('subagents') &&
    allowedTools.includes('subagents')
  ) {
    const spawnTools = await createSpawnTools(context);
    tools.push(...spawnTools);
  }

  return {
    tools,
    instructions,
  };
}
