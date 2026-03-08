---
name: skill-creator
description: Use when the user wants to create a new skill from scratch, update or improve an existing skill, or refine a skill's description so it triggers at the right times. Guides capture intent, draft SKILL.md, and iterate with feedback.
---

# Skill creator

Use this skill when the user wants to create a new skill, improve an existing one, or tune when a skill is used.

## Process

1. **Capture intent** — What should the skill enable? When should it trigger? (phrases, situations, file types.) What format should the output or behavior have? If the conversation already has a workflow the user wants to capture, extract it and confirm with the user.

2. **Draft the skill** — Use the **writing-skills** skill for structure and format. Write a SKILL.md with a clear "Use when..." description and the body (overview, steps, examples). Use **save_skill** to create or update the skill (choose global or workspace scope).

3. **Iterate with feedback** — After saving, suggest the user try a few requests that should trigger the skill. If the skill doesn't trigger when it should, improve the description; if the behavior is wrong, improve the body. Repeat until the user is satisfied.

## Communicating with the user

Adjust language to the user's familiarity with tools and concepts. It's fine to briefly explain terms (e.g. "description" = the short text that tells Greg when to open this skill) if it helps.

## Notes

- Greg does not have a separate eval runner or benchmark viewer. Verification is by trying real prompts and checking that the skill triggers and helps.
- If the user wants to "optimize when the skill triggers," focus on the **description** field: make it specific to the situations where the skill should be used, and avoid summarizing the workflow (so Greg reads the full skill).
