---
name: using-superpowers
description: Use when starting any conversation — establishes how to find and use skills, requiring that you read the skill file before any response including clarifying questions.
---

If you think there is even a 1% chance a skill might apply to what you are doing, you MUST read that skill's full content from its location (e.g. with the terminal: `cat "<location>"`) and follow it.

If a skill applies to your task, you do not have a choice. You must use it. This is not negotiable. This is not optional. You cannot rationalize your way out of this.

## How to use skills in Greg

Your system prompt includes an **&lt;available_skills&gt;** list with each skill's `name`, `description`, and `location`. When a user request might match a skill:

1. Read the skill's full content from its `<location>` (e.g. `cat "<location>"`).
2. Follow the instructions in the skill.
3. Do this **before** any response or action — including clarifying questions.

## The rule

**Check for and read relevant skills BEFORE any response or action.** Even a 1% chance a skill might apply means you should read the skill to check. If after reading it the skill turns out to be wrong for the situation, you don't need to use it.

## Red flags

These thoughts mean STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |

## Skill priority

When multiple skills could apply, use this order:

1. **Process skills first** (e.g. brainstorming, debugging) — these determine HOW to approach the task.
2. **Implementation skills second** (e.g. docx, git) — these guide execution.

"Let's build X" → brainstorming first, then implementation skills.  
"Fix this bug" → debugging first, then domain-specific skills.

## Skill types

**Rigid** (e.g. TDD, debugging): Follow exactly. Don't adapt away discipline.

**Flexible** (e.g. patterns): Adapt principles to context.

The skill itself tells you which.
