import { Type } from '@sinclair/typebox';
import { join } from 'node:path';
import {
  mkdir,
  exists,
  writeFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { customAlphabet } from 'nanoid';
import type { AgentConfig } from '../../index';
import type { ToolContext } from '../../types';
import * as sessions from '../../../gateway/sessions';
import { Storage } from '../../../gateway/sessions/storage/storage';
import { getWorkspacePath } from '../../utilities/impl';
import { getAllowlist } from '../utilities/policy/allowlist';

export type BackgroundUpdate = {
  tool: 'prompt_agent';
  message: string;
};

export const createRunId = () =>
  customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)(5);

interface SubagentConfig {
  name: string;
  emoji: string;
  systemPrompt: string;
  model: { provider: string; id: string };
  tools: ('web_search' | 'web_fetch' | 'exec' | 'files')[];
  execAllowedCommands?: string[];
}

function subagentConfigSchema(parentConfig: AgentConfig) {
  const schema = Type.Object({
    name: Type.String({
      description:
        'Unique, short, human-like name for the sub-agent (used as its ID and workspace folder). Examples: "Nova", "Griffin", "Agent 42". Must not already exist.',
    }),
    emoji: Type.String({
      description:
        'Emoji to use for the sub-agent. Pick something that matches their function and personality. Examples: "👋", "🤔", "👾", "👻", "👽", "🤖", "🤔", "👋".',
    }),
    systemPrompt: Type.String({
      description:
        "Full system prompt that defines the sub-agent's role, goals, and constraints. This is the only instruction the sub-agent gets; be specific.",
    }),
    model: Type.Enum(
      parentConfig.models.reduce((acc, m) => {
        const label = m.role
          ? `${m.model.provider}/${m.model.name} (${m.role})`
          : `${m.model.provider}/${m.model.name} (${m.model.id})`;
        return {
          ...acc,
          [label]: { provider: m.model.provider, id: m.model.id },
        };
      }, {}),
      {
        description:
          'Model the sub-agent will use. Pick from the options (labels show name and role).',
      }
    ),
    tools: Type.Array(
      Type.Enum({
        web_search: 'web_search',
        web_fetch: 'web_fetch',
        exec: 'exec',
        files: 'files',
      }),
      {
        description:
          'Tools the sub-agent will have access to. Pick from the options.',
      }
    ),
    execAllowedCommands: Type.Optional(
      Type.Array(
        Type.String({
          description:
            'Required when allowing the exec tool. Commands the sub-agent will be allowed to run. Supports exact commands, base commands (e.g. "ls"), and glob patterns (*, ?, []). Examples: "ls", "git status *", "npm run *", "rm -rf *".',
        })
      )
    ),
  });

  return {
    schema,
    validate(subagentConfig: SubagentConfig) {
      if (
        subagentConfig.tools.includes('exec') &&
        !subagentConfig.execAllowedCommands
      ) {
        return {
          valid: false,
          message:
            'execAllowedCommands is required when allowing the exec tool.',
        };
      }

      if (subagentConfig.execAllowedCommands) {
        const allowlist = getAllowlist(parentConfig);
        for (const command of subagentConfig.execAllowedCommands) {
          if (!allowlist[command]) {
            return {
              valid: false,
              message: `Command "${command}" is not allowed. Allowed commands: ${Object.keys(allowlist).join(', ')}`,
            };
          }
        }
      }

      return { valid: true, message: null };
    },
  };
}

export async function createSpawnTools({
  config: parentConfig,
  onBackgroundUpdate,
}: ToolContext): Promise<AgentTool[]> {
  const subagentsPath = join(getWorkspacePath(parentConfig), 'subagents');
  await mkdir(subagentsPath, { recursive: true });

  const configSchema = subagentConfigSchema(parentConfig);

  const spawnTool: AgentTool = {
    name: 'spawn_agent',
    label: 'spawn agent',
    description:
      'Create and start a sub-agent that runs in the background. Use when a task is long-running, parallel, or better handled by a dedicated agent. After spawning, use the prompt_agent tool to send prompts to this agent. The sub-agent has its own workspace and can be given web_search, web_fetch, exec, and files tools.',
    parameters: configSchema.schema,
    execute: async (_id: string, params) => {
      const { emoji, name, systemPrompt, model, tools, execAllowedCommands } =
        params as SubagentConfig;

      const { valid, message } = configSchema.validate(
        params as SubagentConfig
      );

      if (!valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: message!,
            },
          ],
          details: {},
        };
      }

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

      const config: SubagentConfig = {
        emoji,
        name,
        systemPrompt,
        model,
        tools,
        execAllowedCommands,
      };
      await writeFile(
        join(workspace, 'config.json'),
        JSON.stringify(config, null, 2)
      );
      await sessions.create('main', createAgentConfig(config));

      const modelLabel = parentConfig.models.find(
        (m) => m.model.id === model.id && m.model.provider === model.provider
      )?.model.name!;

      return {
        content: [
          {
            type: 'text' as const,
            text: `
                Spawned!

                - Emoji: ${emoji}
                - Created agent with name ${name}.
                - Use \`prompt_agent\` tool to prompt the agent.
                - Agent runs on ${modelLabel}
                - Has access to ${tools.join(', ')} tools.
                - Agent runs on \`main\` session. Workspace is: \`${workspace}\`.
                - System Prompt: "${systemPrompt}"

                Give the user a full overview of the agents details.
            `,
          },
        ],
        details: {},
      };
    },
  };

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

      const agents = await Promise.all(
        subagents.map(async (agentName) => {
          const config = await getSubagentConfig(agentName);
          const agentConfig = createAgentConfig(config);

          let working = false;

          try {
            working = sessions.get('main', agentConfig)?.working ?? false;
          } catch {
            // do nothing
            // get() call will error if session is not loaded
            // so if we end up here its just not loaded
          }

          return {
            ...config,
            working,
          };
        })
      );

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

  const renameTool: AgentTool = {
    name: 'rename_agent',
    label: 'rename agent',
    description:
      'Rename an existing spawned subagent. Updates the agent’s directory and config name while preserving its workspace contents.',
    parameters: Type.Object({
      oldName: Type.String({
        description:
          'Current name of the subagent to rename (must match a name returned by list_agents).',
      }),
      newName: Type.String({
        description:
          'New unique name for the subagent. Must not already exist.',
      }),
    }),
    execute: async (_id: string, params) => {
      const { oldName, newName } = params as {
        oldName: string;
        newName: string;
      };

      const oldWorkspace = join(subagentsPath, oldName);

      if (!(await exists(oldWorkspace))) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${oldName} doesn’t exist.`,
            },
          ],
          details: {},
        };
      }

      const newWorkspace = join(subagentsPath, newName);

      if (await exists(newWorkspace)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent with name ${newName} already exists.`,
            },
          ],
          details: {},
        };
      }

      const currentConfig = await getSubagentConfig(oldName);

      await rename(oldWorkspace, newWorkspace);
      await writeFile(
        join(newWorkspace, 'config.json'),
        JSON.stringify(
          {
            ...currentConfig,
            name: newName,
          },
          null,
          2
        )
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Renamed agent "${oldName}" to "${newName}"`,
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
      'Update the system prompt and/or model of an existing spawned subagent. Use this to change the agent’s behavior without recreating it. The agent keeps its workspace and history; only SYSTEM.md is overwritten.',
    parameters: configSchema.schema,
    execute: async (_id: string, params) => {
      const { emoji, name, systemPrompt, model, tools, execAllowedCommands } =
        params as SubagentConfig;

      const { valid, message } = configSchema.validate(
        params as SubagentConfig
      );

      if (!valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: message!,
            },
          ],
          details: {},
        };
      }

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

      const config = await getSubagentConfig(name);
      await writeFile(
        join(subagentsPath, name, 'config.json'),
        JSON.stringify(
          { ...config, emoji, systemPrompt, model, tools, execAllowedCommands },
          null,
          2
        )
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `
                Updated "${name}"!
                - Emoji: ${emoji}
                - Runs on ${model.provider}/${model.id}
                - Has access to ${tools.join(', ')} tools.
                - Agent runs on \`main\` session. Workspace is: \`${workspace}\`.
                - Use \`prompt_agent\` tool to prompt the agent.
                - System Prompt: "${systemPrompt}"
            `,
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
      'Send a prompt to a spawned subagent. This is fire-and-forget: the subagent runs the prompt asynchronously and will send a background update when done. Do NOT combine this with immediate polling of status or messages unless the user explicitly asks for it. Use list_agents first to get valid agent names.',
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

      const config = await getSubagentConfig(name);
      const agentConfig = createAgentConfig(config);

      if (!sessions.exists('main', agentConfig)) {
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

      const session = await sessions.load('main', agentConfig, {
        getSystemPrompt(toolInstructions: string) {
          return `${config.systemPrompt}\n\n${toolInstructions}`;
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
      'Fetch the current status of a spawned subagent. Use ONLY when the user explicitly asks to inspect an agent (for example: “show me Scout’s status / system prompt”). Do NOT call this automatically after prompt_agent; subagents report back via background updates. Returns JSON: { name, loaded, working, model, systemPrompt }. Use list_agents to get valid names.',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Name of the subagent to fetch (must match a name from list_agents).',
      }),
    }),
    execute: async (_id, params) => {
      const { name } = params as { name: string };
      const config = await getSubagentConfig(name);
      const agentConfig = createAgentConfig(config);

      if (!sessions.exists('main', agentConfig)) {
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

      let loaded = false;
      let working = false;

      try {
        const loadedSession = sessions.get('main', agentConfig);
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
              ...config,
              loaded,
              working,
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
      'Fetch stored messages for a spawned subagent when the USER explicitly requests to read that agent’s history (for example: “show me Scout’s last 5 messages”). Do NOT call this automatically after prompt_agent; prompting is fire-and-forget and the subagent will push a background update when it has something to report. Beware: by default this returns the entire session history, which can be large. Use the optional "limit" parameter to only retrieve the most recent N messages (tail).',
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
    execute: async (_id, params) => {
      const { name, limit } = params as { name: string; limit?: number };

      const config = await getSubagentConfig(name);
      const agentConfig = createAgentConfig(config);

      if (!sessions.exists('main', agentConfig)) {
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

      const storage = new Storage(agentConfig);
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

      if (!(await exists(join(subagentsPath, name)))) {
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

      await unlink(join(subagentsPath, name));

      return {
        content: [
          {
            type: 'text' as const,
            text: `Destroyed agent "${name}"`,
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
    renameTool,
    updateTool,
    destroyTool,
  ];

  async function getSubagentConfig(name: string): Promise<SubagentConfig> {
    const path = join(subagentsPath, name, 'config.json');

    if (!(await exists(path))) {
      throw new Error(`Subagent config file ${path} not found`);
    }

    const config = readFileSync(path, 'utf8');
    return JSON.parse(config);
  }

  function createAgentConfig({
    name,
    model,
    tools,
    execAllowedCommands,
  }: SubagentConfig): AgentConfig {
    const modelConfig =
      parentConfig.models.find(
        (m) => m.model.id === model.id && m.model.provider === model.provider
      ) ?? null;

    if (!modelConfig) {
      throw new Error(`Model ${model.id} not found in parent config.`);
    }

    return {
      id: name,
      workspace: join(subagentsPath, name),
      models: [
        {
          role: 'primary',
          model: modelConfig.model,
          key: modelConfig.key,
        },
      ],
      tools: {
        allow: tools,
        webSearch: tools.includes('web_search')
          ? parentConfig.tools?.webSearch
          : undefined,
        guard: {
          enabled: parentConfig.tools?.guard?.enabled ?? false,
          ask: false,
          exec: {
            allowlist: execAllowedCommands?.reduce(
              (acc, command) => ({
                ...acc,
                [command]: { allow: true },
              }),
              {}
            ),
          },
        },
      },
    };
  }
}
