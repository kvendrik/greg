import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { getWorkspacePath } from '../utilities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');
const WORKSPACE_SKILLS_DIR = path.join(getWorkspacePath(), 'skills');
const SKILL_FILENAME = 'SKILL.md';

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
}

export function getSkillsDir(): string {
  return path.resolve(SKILLS_DIR);
}

export function discoverSkills(): SkillMeta[] {
  const dir = getSkillsDir();
  const workspaceSkillsDir = path.resolve(WORKSPACE_SKILLS_DIR);

  let globalSkills: fs.Dirent[] = [];
  let workspaceSkills: fs.Dirent[] = [];

  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    globalSkills = fs.readdirSync(dir, { withFileTypes: true });
  }

  if (
    fs.existsSync(workspaceSkillsDir) &&
    fs.statSync(workspaceSkillsDir).isDirectory()
  ) {
    workspaceSkills = fs.readdirSync(workspaceSkillsDir, {
      withFileTypes: true,
    });
  }

  const entries = [...globalSkills, ...workspaceSkills];
  const result: SkillMeta[] = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dir, ent.name);
    const skillMdPath = path.join(skillPath, SKILL_FILENAME);
    if (!fs.existsSync(skillMdPath) || !fs.statSync(skillMdPath).isFile())
      continue;
    try {
      const raw = fs.readFileSync(skillMdPath, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const name = typeof data?.name === 'string' ? data.name.trim() : ent.name;
      const description =
        typeof data?.description === 'string' ? data.description.trim() : '';
      result.push({
        name: name || ent.name,
        description: description || '',
        location: path.resolve(skillMdPath),
      });
    } catch {
      result.push({
        name: ent.name,
        description: '',
        location: path.resolve(skillMdPath),
      });
    }
  }

  return result;
}

export function getInstructions(): string {
  const skills = discoverSkills();
  if (skills.length === 0) return '';
  const items = skills
    .map(
      (s) =>
        `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n    <location>${escapeXml(s.location)}</location>\n  </skill>`
    )
    .join('\n');
  const browserUsageBody = getBrowserUsageSkillBody();
  const browserSection =
    browserUsageBody === ''
      ? `
### Browser Automation

Before using the run_browser_task tool, read the **browser-usage** skill from the list above (use its <location> with read_file or cat) and follow it: send one step per call so the user gets frequent updates.`
      : `
### Browser Automation

When using run_browser_task you must follow these rules (from the browser-usage skill):

<browser_usage_skill>
${browserUsageBody}
</browser_usage_skill>

Always send one clear action per run_browser_task call. Give the user a short update after each step when it makes sense. Use the next call to continue from where the previous one left off; the session is kept alive.`;
  return `
## Skills

<available_skills>
  ${items}
</available_skills>

When a user request matches an available skill, read that skill's full content from its <location> (e.g. with the terminal: cat "<location>") and follow the instructions.

When you learn or establish something reusable (workflow, rule, convention, or capability), you must call save_skill before considering the exchange complete. Examples: a new CLI or editor workflow, a project convention, a preference for how to do X, or any instruction you give that the user might want applied again. If in doubt, save it as a skill.
${browserSection}
`;
}

const BROWSER_USAGE_SKILL_PATH = path.join(
  SKILLS_DIR,
  'browser-usage',
  SKILL_FILENAME
);

function getBrowserUsageSkillBody(): string {
  if (!fs.existsSync(BROWSER_USAGE_SKILL_PATH)) return '';
  try {
    const raw = fs.readFileSync(BROWSER_USAGE_SKILL_PATH, 'utf8');
    const parsed = matter(raw);
    return (parsed.content ?? '').trim();
  } catch {
    return '';
  }
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
  content: string
): { name: string; path: string } {
  const skillName = normalizeAndValidateSkillName(name);

  const rawDescription = (description ?? '').trim();
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

  const skillsDir = getSkillsDir();
  const workspaceSkillsDir = path.resolve(WORKSPACE_SKILLS_DIR);
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(workspaceSkillsDir, { recursive: true });
  const skillDir = path.join(skillsDir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillMdPath = path.join(skillDir, SKILL_FILENAME);

  const frontmatter = `---
name: ${skillName}
description: "${safeDescription}"
---

`;
  fs.writeFileSync(skillMdPath, frontmatter + content, 'utf8');
  return { name: skillName, path: skillMdPath };
}

const saveSkillTool: AgentTool = {
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
  }),
  execute: async (_id, params) => {
    const { name, description, content } = params as {
      name: string;
      description: string;
      content: string;
    };
    try {
      const result = saveSkill(name, description, content ?? '');
      const text = `Skill "${result.name}" saved to ${result.path}.`;
      return { content: [{ type: 'text' as const, text }], details: {} };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text }], details: {} };
    }
  },
};

export const tools: AgentTool[] = [saveSkillTool];
