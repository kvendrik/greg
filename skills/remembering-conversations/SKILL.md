---
name: remembering-conversations
description: Use when user asks "how should I..." or "what's the best approach..." after exploring something, or when you've tried to solve something and are stuck, or for unfamiliar workflows, or when user references past work. Search workspace memory and conversation notes before reinventing.
---

# Remembering conversations

**Core principle:** Search before reinventing. Searching costs little; reinventing or repeating mistakes costs everything.

## When to use

Use your workspace memory and conversation notes in these situations:

**After understanding the task:**
- User asks "how should I..." or "what's the best approach..."
- You've explored the codebase or context and need to make a decision
- User asks for an implementation approach after describing what they want

**When you're stuck:**
- You've investigated a problem and can't find the solution
- Facing a complex problem without an obvious solution in current context
- Need to follow an unfamiliar workflow or process

**When historical signals are present:**
- User says "last time", "before", "we discussed", "you implemented"
- User asks "why did we...", "what was the reason..."
- User says "do you remember...", "what do we know about..."

## How to search in Greg

- Your system prompt already tells you to call **get_recent_conversation_notes** before your first reply and to use **search_past_conversations** when you need something specific. For the situations listed above (e.g. "how should I...", stuck, user references past work), use those tools: **get_recent_conversation_notes** and **search_past_conversations**.
- You also have USER.md and IDENTITY.md in your workspace; read them when relevant. Prefer existing notes and summaries over guessing or starting from scratch.

**Don't search first:**
- For current codebase structure (use your file/code tools to explore first)
- For information already in the current conversation
- Before understanding what the user is asking you to do

## After finding relevant context

Synthesize what you found and give the user actionable guidance. If you didn't find anything relevant, say so and proceed with your best judgment — but always check when the situation above applies.
