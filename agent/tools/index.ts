import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { TextContent } from '@mariozechner/pi-ai';
import type { ToolContext } from '../types';
import { getBrowserInstructions, getBrowserTools } from './browser';
import { getExecTools, getExecInstructions } from './exec';
import { load as loadMemory } from './memory';
import {
  getInstructions as getSkillsInstructions,
  getTools as getSkillTools,
} from './skills';
import { getFilesTools, getFilesToolsInstructions } from './files';
import { createWebFetchTool } from './web-fetch';
import { createWebSearchTool } from './web-search';
import { createSpawnTools } from './spawn';
import { evaluatePolicy } from './utilities/policy';

export async function get(
  conversationStartIso: string,
  context: ToolContext
): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const deniedTools = context.config.tools.deny ?? null;
  const allowedTools = context.config.tools.allow ?? [
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
    instructions += getFilesToolsInstructions();
  }

  if (!deniedTools?.includes('memory') && allowedTools.includes('memory')) {
    const memory = await loadMemory(context.config, conversationStartIso);
    tools.push(...memory.tools);
    instructions += memory.instructions;
  }

  if (!deniedTools?.includes('exec') && allowedTools.includes('exec')) {
    tools.push(...getExecTools(context));
    instructions += getExecInstructions();
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

  tools = tools.map((tool) => ({
    ...tool,
    execute: async (_id, params: unknown, signal) => {
      const policy = await evaluatePolicy(
        {
          name: tool.name,
          label: tool.label,
          params: params as Record<string, unknown>,
        },
        context
      );

      let resultPrefix = '';

      if (!policy.allowed) {
        return constructGuardResponse(policy.reason ?? 'Tool call not allowed');
      } else if (policy.reason) {
        resultPrefix += `[Guard Result]${policy.reason}[/Guard Result]\n\n`;
      }

      const result = await tool.execute(_id, params, signal);
      const firstTextContent = result.content.findIndex(
        (content) => content.type === 'text'
      );

      (result.content[firstTextContent] as TextContent).text =
        resultPrefix + (result.content[firstTextContent] as TextContent).text;

      return result;

      function constructGuardResponse(
        message: string
      ): AgentToolResult<object> {
        return {
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
          details: {},
        };
      }
    },
  }));

  return {
    tools,
    instructions,
  };
}
