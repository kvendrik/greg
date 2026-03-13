---
name: skill-creator
description: Use when creating a new skill, editing an existing skill, or verifying a skill works before relying on it. Covers what a skill is, when to create one, format and structure, and the process to capture intent, draft with save_skill, and iterate with feedback.
---

# Skill creator

Use this skill when you need to create a new skill, edit an existing one, verify a skill works, or tune when a skill is used.

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

## Process

1. **Capture intent** — What should the skill enable? When should it trigger? (phrases, situations, file types.) What format should the output or behavior have? If the conversation already has a workflow the user wants to capture, extract it and confirm with the user.

2. **Draft the skill** — Write a SKILL.md with a clear "Use when..." description and the body (overview, when to use, steps, examples). Follow the format and description guidelines above. Use **save_skill** to create or update the skill (choose global or workspace scope).

3. **Iterate with feedback** — After saving, suggest the user try a few requests that should trigger the skill. If the skill doesn't trigger when it should, improve the description; if the behavior is wrong, improve the body. Repeat until the user is satisfied.

## Communicating with the user

Adjust language to the user's familiarity with tools and concepts. It's fine to briefly explain terms (e.g. "description" = the short text that tells Greg when to open this skill) if it helps.

## After writing a skill

- If you created or changed a skill, say what you did and where it lives.
- Suggest the user try a request that would trigger it, to verify it works as intended.

## Notes

- Greg does not have a separate eval runner or benchmark viewer. Verification is by trying real prompts and checking that the skill triggers and helps.
- If the user wants to "optimize when the skill triggers," focus on the **description** field: make it specific to the situations where the skill should be used, and avoid summarizing the workflow (so Greg reads the full skill).
