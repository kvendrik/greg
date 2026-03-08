---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before relying on them. Greg stores skills in project skills/ and workspace skills/ and uses save_skill to create or update them.
---

# Writing skills

Use this skill when you need to create a new skill, edit an existing one, or make sure a skill is correct before use.

## What is a skill?

A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help Greg (and future sessions) find and apply effective approaches.

**Skills are:** Reusable techniques, patterns, tools, reference guides.

**Skills are NOT:** One-off narratives about how you solved a problem once.

## When to create a skill

**Create when:**
- The technique wasn't intuitively obvious and you'd reference it again
- The pattern applies broadly (not project-specific)
- Others (or future you) would benefit

**Don't create for:**
- One-off solutions
- Standard practices well documented elsewhere
- Project-specific conventions (use workspace notes or project docs instead)

## Greg's skill format

Skills live in **directories** under `skills/` (project) or the workspace `skills/` directory. Each skill is a folder containing **SKILL.md**.

**SKILL.md structure:**
- **Frontmatter (YAML):** `name` and `description` only.
- **name:** Lowercase letters, numbers, hyphens only (e.g. `my-skill-name`).
- **description:** Start with "Use when..." and describe **only when to use** (triggering conditions). Do **not** summarize the skill's process or workflow in the description — that encourages skipping the full content.

**Body:** Overview, when to use (and when not), steps or patterns, examples, common mistakes. Keep it scannable (bullets, tables, short sections).

Use the **save_skill** tool to create or update a skill. Choose **global** (project skills/) or **workspace** (workspace skills/) scope.

## Description guidelines

The description is what Greg uses to decide whether to read the skill. Make it answer: "Should I read this skill right now?"

- Start with **"Use when..."**
- Include specific triggers, symptoms, or situations
- **Do not** summarize the workflow or steps in the description (that can make Greg follow the description instead of reading the full skill)
- Keep it under a few hundred characters if possible

## Skill types

- **Technique:** Concrete method with steps (e.g. how to run a CLI, how to stage and commit).
- **Pattern:** Way of thinking about problems (e.g. when to search memory first).
- **Reference:** API docs, command reference, file-format notes (e.g. docx, pdf).

## After writing a skill

- If you created or changed a skill, say what you did and where it lives.
- Suggest the user try a request that would trigger it, to verify it works as intended.
