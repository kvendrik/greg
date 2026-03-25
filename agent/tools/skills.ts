import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { AgentConfig, ToolContext } from '../types';
import { getWorkspacePath } from '../utilities/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
  throw new Error('Root directory is not set correctly.');
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

/** Per spec: lowercase letters, numbers, hyphens only; 1-64 chars; no leading/trailing/consecutive hyphens. */
function normalizeAndValidateSkillName(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    throw new Error('Skill name cannot be empty.');
  }
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Skill name must be at most ${MAX_NAME_LENGTH} characters (got ${normalized.length}).`
    );
  }
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error(
      'Skill name may only contain lowercase letters, numbers, and hyphens.'
    );
  }
  if (normalized.startsWith('-') || normalized.endsWith('-')) {
    throw new Error('Skill name cannot start or end with a hyphen.');
  }
  if (normalized.includes('--')) {
    throw new Error('Skill name cannot contain consecutive hyphens.');
  }
  return normalized;
}

export interface SkillMeta {
  name: string;
  description: string;
  location: string;
  /** Optional: CLI names (e.g. "gog") and/or "env:VAR" for required env vars. Used by `greg doctor`. */
  requires?: string[];
}

const paths = (
  config: AgentConfig
): { globalSkills: string; workspaceSkills: string } => ({
  globalSkills: path.join(rootDir, 'skills'),
  workspaceSkills: path.join(getWorkspacePath(config), 'skills'),
});

/** When the same skill name exists in both project and workspace, workspace wins. */
export function discoverSkills(config: AgentConfig): SkillMeta[] {
  type SkillEntry = { baseDir: string; ent: fs.Dirent; filename: string };

  const skillDirs = Array.from(
    new Set([
      // Skills directory packaged with Greg (relative to this file)
      { dir: paths(config).globalSkills, filename: 'SKILL.md' },
      // AGENT files in hub directory
      { dir: path.join(rootDir, 'hub'), filename: 'AGENT.md' },
      // Skills directory in the current working project (useful in dev)
      {
        dir: paths(config).workspaceSkills,
        filename: 'SKILL.md',
      },
    ])
  );

  const entries: SkillEntry[] = [];

  for (const { dir, filename } of skillDirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const dirents = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of dirents) {
        entries.push({ baseDir: dir, ent, filename });
      }
    }
  }

  const byName = new Map<string, SkillMeta>();

  for (const { baseDir, ent, filename } of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(baseDir, ent.name);
    const skillMdPath = path.join(skillPath, filename);

    if (!fs.existsSync(skillMdPath) || !fs.statSync(skillMdPath).isFile())
      continue;

    try {
      const raw = fs.readFileSync(skillMdPath, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const name = typeof data.name === 'string' ? data.name.trim() : ent.name;
      const description =
        typeof data.description === 'string' ? data.description.trim() : '';
      const requires = parseRequires(data.requires);
      const meta: SkillMeta = {
        name: name || ent.name,
        description: description || '',
        location: path.resolve(skillMdPath),
        ...(requires.length > 0 ? { requires } : {}),
      };
      byName.set(meta.name, meta);
    } catch {
      const meta: SkillMeta = {
        name: ent.name,
        description: '',
        location: path.resolve(skillMdPath),
      };
      byName.set(meta.name, meta);
    }
  }

  return [...byName.values()];
}

function parseRequires(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0
    );
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}

export function getInstructions(config: AgentConfig): string {
  const skills = discoverSkills(config);
  if (skills.length === 0) return '';
  const items = skills
    .map(
      (s) =>
        `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n    <location>${escapeXml(s.location)}</location>\n  </skill>`
    )
    .join('\n');
  return `
## Skills

<available_skills>
  ${items}
</available_skills>

When a user request matches an available skill, read that skill's full content from its <location> (e.g. with the terminal: cat "<location>") and follow the instructions.

Some skills list requirements (e.g. a CLI on PATH or an environment variable). If you try to use a skill and its requirements are not available (e.g. the command is not found, or an API returns an auth error), do not keep retrying. Tell the user you have a skill for that task but it cannot be used because a requirement is missing, and suggest they run \`greg doctor\` to see what is needed.

When you learn or establish something reusable (workflow, rule, convention, or capability), you must call save_skill before considering the exchange complete. Examples: a new CLI or editor workflow, a project convention, a preference for how to do X, or any instruction you give that the user might want applied again. If in doubt, save it as a skill.

### Hub
Skills from hub modules (e.g. Notion) must be run with the \`greg hub\` prefix. Example: \`notion search\` becomes \`greg hub notion search\`.
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function saveSkill(
  name: string,
  description: string,
  content: string,
  filePath: string | undefined,
  scope: 'global' | 'workspace' | undefined,
  config: AgentConfig
): { name: string; path: string } {
  const skillName = normalizeAndValidateSkillName(name);

  const rawDescription = description.trim();

  if (!rawDescription) {
    throw new Error('Skill description is required and must be non-empty.');
  }

  if (rawDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `Skill description must be at most ${MAX_DESCRIPTION_LENGTH} characters (got ${rawDescription.length}).`
    );
  }

  // Single-line, YAML-safe description (newlines and unescaped quotes would break frontmatter)
  const safeDescription = rawDescription
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  const frontmatter = `---
name: ${skillName}
description: "${safeDescription}"
---

`;
  let finalPath: string;
  if (filePath) {
    finalPath = filePath;
  } else {
    if (scope === undefined) {
      throw new Error(
        'Scope is required when creating a new skill without a known path. Ask the user whether the skill should be "global" (for all agents/users) or "workspace" (only for this agent/user).'
      );
    }
    finalPath = filePathForSkillName(skillName, scope, config);
  }
  fs.writeFileSync(finalPath, frontmatter + content, 'utf8');
  return { name: skillName, path: finalPath };

  function filePathForSkillName(
    name: string,
    scope: 'global' | 'workspace',
    cfg: AgentConfig
  ): string {
    const { globalSkills, workspaceSkills } = paths(cfg);

    if (scope === 'global') {
      fs.mkdirSync(globalSkills, { recursive: true });
      const skillDir = path.join(globalSkills, name);
      fs.mkdirSync(skillDir, { recursive: true });
      return path.join(skillDir, 'SKILL.md');
    }

    const workspaceSkillsDir = path.resolve(workspaceSkills);
    fs.mkdirSync(workspaceSkillsDir, { recursive: true });
    const skillDir = path.join(workspaceSkillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    return path.join(skillDir, 'SKILL.md');
  }
}

function createSaveSkillTool(config: AgentConfig): AgentTool {
  return {
    name: 'save_skill',
    label: 'save skill',
    description:
      'Create or update a skill. Call whenever you learn or establish something reusable: a workflow, rule, convention, or capability. Prefer saving when in doubt. Use at the end of your response after teaching or applying something new (e.g. new CLI workflow, project convention, how the user wants something done).',
    parameters: Type.Object({
      name: Type.String({
        description:
          'Skill name: 1-64 chars, lowercase letters numbers hyphens only; no leading/trailing/consecutive hyphens (underscores are converted to hyphens). Skills should have names that are specific to their use-case. E.g. a skill to read Gmail emails shouldn’t be called read-emails but read-gmail.',
      }),
      description: Type.String({
        description:
          'Short description for the skill frontmatter (required, 1-1024 characters)',
      }),
      content: Type.String({
        description:
          'Markdown body of the skill (instructions and content after the frontmatter)',
      }),
      path: Type.Optional(
        Type.String({
          description:
            'Path to the skill file to save to in case the skill already exists.',
        })
      ),
      scope: Type.Optional(
        Type.Union([
          Type.Literal('global', {
            description:
              'Save the skill globally so it is available to all agents/users and becomes part of Greg’s shared repository.',
          }),
          Type.Literal('workspace', {
            description:
              'Save the skill only for this agent/user in the current workspace.',
          }),
        ])
      ),
    }),
    execute: (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { name, description, content, path, scope } = params as {
        name: string;
        description: string;
        content: string;
        path?: string;
        scope?: 'global' | 'workspace';
      };
      try {
        const result = saveSkill(
          name,
          description,
          content,
          path,
          scope,
          config
        );
        const text = `Skill "${result.name}" saved to ${result.path}.`;
        return Promise.resolve({
          content: [{ type: 'text' as const, text }],
          details: {},
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return Promise.resolve({
          content: [{ type: 'text' as const, text }],
          details: {},
        });
      }
    },
  };
}

export function getTools(context: ToolContext): AgentTool[] {
  const config = context.config;
  return [createSaveSkillTool(config)];
}
