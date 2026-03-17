import { Type } from '@sinclair/typebox';
import { join } from 'node:path';
import { mkdir, exists, writeFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { customAlphabet } from 'nanoid';
import type { AgentConfig } from '../../index';
import type { ToolContext } from '../../types';
import * as sessions from '../../../gateway/sessions';
import { Storage } from '../../../gateway/sessions/storage/storage';
import { getWorkspacePath } from '../workspace';

export type BackgroundUpdate = {
  tool: 'prompt_agent';
  message: string;
};

export const createRunId = () =>
  customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)(5);

export async function createSpawnTools({
  config,
  onBackgroundUpdate,
}: ToolContext): Promise<AgentTool[]> {
  const subagentsPath = join(getWorkspacePath(config), 'subagents');
  await mkdir(subagentsPath, { recursive: true });

  const listTool: AgentTool = {
    name: 'list_agents',
    label: 'list agents',
    description:
      'List all spawned subagents. Returns a JSON array of { name, working, model, systemPrompt } for each. Call this first to see which agents exist before using prompt_agent.',
    parameters: Type.Object({}),
    execute: async (_id: string) => {
      const entries = await readdir(subagentsPath, { withFileTypes: true });
      const subagents = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      const agents = subagents.map((agentName) => {
        const subagentConfig = createSubagentConfig(
          agentName,
          join(subagentsPath, agentName)
        );

        let working = false;

        try {
          working = sessions.get('main', subagentConfig)?.working ?? false;
        } catch {
          // do nothing
          // get() call will error if session is not loaded
          // so if we end up here its just not loaded
        }

        return {
          name: agentName,
          working,
          model: subagentConfig.models[0].model.name,
          systemPrompt: readFileSync(
            join(subagentsPath, agentName, 'SYSTEM.md'),
            'utf8'
          ),
        };
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(agents),
          },
        ],
        details: {},
      };
    },
  };

  const spawnTool: AgentTool = {
    name: 'spawn_agent',
    label: 'spawn agent',
    description:
      'Create and start a sub-agent that runs in the background. Use when a task is long-running, parallel, or better handled by a dedicated agent. After spawning, use the prompt_agent tool to send prompts to this agent. The sub-agent has its own workspace and only web_search and web_fetch tools.',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Unique, short, human-like name for the sub-agent (used as its ID and workspace folder). Examples: "Nova", "Griffin", "Agent 42". Must not already exist.',
      }),
      systemPrompt: Type.String({
        description:
          "Full system prompt that defines the sub-agent's role, goals, and constraints. This is the only instruction the sub-agent gets; be specific.",
      }),
    }),
    execute: async (_id: string, params) => {
      const { name, systemPrompt } = params as {
        name: string;
        systemPrompt: string;
      };

      const workspace = join(subagentsPath, name);

      if (await exists(workspace)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${name} already exists.`,
            },
          ],
          details: {},
        };
      }

      await mkdir(workspace, { recursive: true });

      const model = config.models.find(
        (model) => model.role === 'primary'
      )!.model;

      await writeFile(join(workspace, 'SYSTEM.md'), systemPrompt);
      await sessions.create('main', createSubagentConfig(name, workspace));

      return {
        content: [
          {
            type: 'text' as const,
            text: `
                Spawned!
                - Created agent with name ${name}.
                - Use \`prompt_agent\` tool to prompt the agent.
                - Agent runs on ${model.name} and has access to \`web_search\` and \`web_fetch\` tools.
                - Agent runs on \`main\` session. Workspace is: \`${workspace}\`.
            `,
          },
        ],
        details: {},
      };
    },
  };

  const updateTool: AgentTool = {
    name: 'update_agent',
    label: 'update agent',
    description:
      'Update the system prompt of an existing spawned subagent. Use this to change the agent’s behavior without recreating it. The agent keeps its workspace and history; only SYSTEM.md is overwritten.',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Unique, short, human-like name for the sub-agent (used as its ID and workspace folder). Examples: "Nova", "Griffin", "Agent 42". Must not already exist.',
      }),
      systemPrompt: Type.String({
        description:
          "Full system prompt that defines the sub-agent's role, goals, and constraints. This is the only instruction the sub-agent gets; be specific.",
      }),
    }),
    execute: async (_id: string, params) => {
      const { name, systemPrompt } = params as {
        name: string;
        systemPrompt: string;
      };

      const workspace = join(subagentsPath, name);

      if (!(await exists(workspace))) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${name} doesn’t exist.`,
            },
          ],
          details: {},
        };
      }

      await writeFile(join(workspace, 'SYSTEM.md'), systemPrompt);

      return {
        content: [
          {
            type: 'text' as const,
            text: `System prompt of agent "${name}" updated to "${systemPrompt}".`,
          },
        ],
        details: {},
      };
    },
  };

  const promptTool: AgentTool = {
    name: 'prompt_agent',
    label: 'prompt agent',
    description:
      'Send a prompt to a spawned subagent. The agent runs the prompt and returns a transcript of its response and tool calls. Use list_agents first to get valid agent names.',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Name of the subagent to prompt (must match a name returned by list_agents).',
      }),
      prompt: Type.String({
        description: 'The instruction or question to send to the subagent.',
      }),
    }),
    execute: async (_id, params, signal) => {
      const { name, prompt } = params as { name: string; prompt: string };

      const workspace = join(subagentsPath, name);
      const subagentConfig = createSubagentConfig(name, workspace);

      if (!sessions.exists('main', subagentConfig)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${name} does not exist.`,
            },
          ],
          details: {},
        };
      }

      const systemPrompt = readFileSync(join(workspace, 'SYSTEM.md'), 'utf8');
      const session = await sessions.load('main', subagentConfig, {
        getSystemPrompt(toolInstructions: string) {
          return `${systemPrompt}\n\n${toolInstructions}`;
        },
      });

      const runId = createRunId();
      let transcript = '';

      session.subscribe('tool', {
        onThinking: (chunk) => {
          transcript += chunk;
        },
        onContent: (chunk) => {
          transcript += chunk;
        },
        onToolcall: (name, args) => {
          transcript += `[${name}](${JSON.stringify(args)})`;
        },
        onTurnDone: () => {
          onBackgroundUpdate({
            tool: 'prompt_agent',
            message: `[Subagent "${name}" response for run "${runId}"]: "${transcript}"`,
          });
          session.unsubscribe('tool');
        },
      });

      session.prompt(
        { content: prompt, images: [] },
        {
          channelId: 'tool',
          signal,
        }
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Sent prompt "${prompt}" to agent "${name}" with run ID "${runId}". Agent will report back when done.`,
          },
        ],
        details: {},
      };
    },
  };

  const getTool: AgentTool = {
    name: 'get_agent_status',
    label: 'get agent status',
    description:
      'Fetch the full state of one spawned subagent: its system prompt and full message history. Use when you need to see what the agent was told, what it has done so far, or to inspect context before prompting it. Returns JSON: { name, systemPrompt, messages }. Use list_agents to get valid names.',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Name of the subagent to fetch (must match a name from list_agents).',
      }),
    }),
    execute: async (_id, params, signal) => {
      const { name } = params as { name: string };

      const workspace = join(subagentsPath, name);
      const subagentConfig = createSubagentConfig(name, workspace);

      if (!sessions.exists('main', subagentConfig)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${name} does not exist.`,
            },
          ],
          details: {},
        };
      }

      const systemPrompt = readFileSync(join(workspace, 'SYSTEM.md'), 'utf8');
      const storage = new Storage(subagentConfig);

      let loaded = false;
      let working = false;

      try {
        const loadedSession = sessions.get('main', subagentConfig);
        if (loadedSession) {
          loaded = true;
          working = loadedSession?.working ?? false;
        }
      } catch {
        // do nothing
        // get() call will error if session is not loaded
        // so if we end up here its just not loaded
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              name,
              loaded,
              working,
              model: subagentConfig.models[0].model.name,
              systemPrompt,
            }),
          },
        ],
        details: {},
      };
    },
  };

  const getMessagesTool: AgentTool = {
    name: 'get_agent_messages',
    label: 'get agent messages',
    description:
      'Fetch all stored messages for a spawned sub-agent. Beware: by default this returns the entire session history, which can be large. Use the optional "limit" parameter to only retrieve the most recent N messages (tail).',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Name of the sub-agent whose messages you want to read. This maps to the agent name used when spawning.',
      }),
      limit: Type.Optional(
        Type.Number({
          description:
            'Optional maximum number of most recent messages to return (tail). If omitted, the full message history is returned.',
          minimum: 1,
        })
      ),
    }),
    execute: async (_id, params, signal) => {
      const { name, limit } = params as { name: string; limit?: number };

      const workspace = join(subagentsPath, name);
      const subagentConfig = createSubagentConfig(name, workspace);

      if (!sessions.exists('main', subagentConfig)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${name} does not exist.`,
            },
          ],
          details: {},
        };
      }

      const storage = new Storage(subagentConfig);
      const storedSession = await storage.load('main');

      const allMessages = storedSession.messages ?? [];
      const messages =
        typeof limit === 'number' && limit > 0 && limit < allMessages.length
          ? allMessages.slice(-limit)
          : allMessages;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(messages),
          },
        ],
        details: {},
      };
    },
  };

  const destroyTool: AgentTool = {
    name: 'destroy_agent',
    label: 'destroy agent',
    description:
      'Destroy a spawned subagent by deleting its stored session data. Use this when an agent is no longer needed. This cannot be undone.',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Name of the subagent to destroy (must match a name returned by list_agents).',
      }),
    }),
    execute: async (_id, params) => {
      const { name } = params as { name: string };
      const workspace = join(subagentsPath, name);
      const subagentConfig = createSubagentConfig(name, workspace);

      if (!sessions.exists('main', subagentConfig)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${name} does not exist.`,
            },
          ],
          details: {},
        };
      }

      sessions.destroy('main', subagentConfig);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Destroyed agent "${name}". Its session data has been removed.`,
          },
        ],
        details: {},
      };
    },
  };

  return [
    listTool,
    spawnTool,
    promptTool,
    getTool,
    getMessagesTool,
    updateTool,
    destroyTool,
  ];

  function createSubagentConfig(name: string, workspace: string): AgentConfig {
    return {
      id: name,
      workspace,
      models: config.models,
      tools: {
        allow: ['web_search', 'web_fetch'],
        webSearch: config.tools?.webSearch,
        guard: config.tools?.guard,
      },
    };
  }
}
