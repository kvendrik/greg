import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { Tool } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');
const SKILL_FILENAME = 'SKILL.md';

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

/** Per spec: lowercase letters, numbers, hyphens only; 1-64 chars; no leading/trailing/consecutive hyphens. */
function normalizeAndValidateSkillName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
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
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
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

export function getAvailableSkillsPrompt(): string {
  const skills = discoverSkills();
  if (skills.length === 0) return '';
  const items = skills
    .map(
      (s) =>
        `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n    <location>${escapeXml(s.location)}</location>\n  </skill>`
    )
    .join('\n');
  return `
<available_skills>
  ${items}
</available_skills>
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
  content: string
): string {
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
  fs.mkdirSync(skillsDir, { recursive: true });
  const skillDir = path.join(skillsDir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillMdPath = path.join(skillDir, SKILL_FILENAME);

  const frontmatter = `---
name: ${skillName}
description: "${safeDescription}"
---

`;
  fs.writeFileSync(skillMdPath, frontmatter + content, 'utf8');
  return skillName;
}

const saveSkillTool: Tool<{
  name: string;
  description: string;
  content: string;
}> = {
  spec: {
    name: 'save_skill',
    description:
      'Create or update a skill. Use when you learn something new worth reusing (workflow, rule, or capability).',
    input_schema: {
      type: 'object',
      required: ['name', 'description', 'content'],
      properties: {
        name: {
          type: 'string',
          description:
            'Skill name: 1-64 chars, lowercase letters numbers hyphens only; no leading/trailing/consecutive hyphens (underscores are converted to hyphens)',
        },
        description: {
          type: 'string',
          description:
            'Short description for the skill frontmatter (required, 1-1024 characters)',
        },
        content: {
          type: 'string',
          description:
            'Markdown body of the skill (instructions and content after the frontmatter)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const skillName = saveSkill(args.name, args.description, args.content ?? '');
      return { content: `Skill "${skillName}" saved.` };
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const tools = [saveSkillTool];
