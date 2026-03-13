---
name: remembering-conversations
description: Use when user asks "how should I..." or "what's the best approach..." after exploring something, or when you've tried to solve something and are stuck, or for unfamiliar workflows, or when user references past work. Search workspace memory before reinventing.
---

# Remembering conversations

**Core principle:** Search before reinventing. Searching costs little; reinventing or repeating mistakes costs everything.

When the user is **explicitly** asking about a prior conversation or "what was said before," also read the **session-logs** skill — it tells you when to prefer session transcripts over notes and how to search them.

## When to use

Use your workspace memory (daily notes and session transcripts) in these situations:

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

## How to search

- Use the **memory tools**: **memory_recent**, **memory_search**, **memory_summarize**, **memory_get**.
- **Scope:** Prefer **scope: notes** first (daily notes are condensed). If the answer isn't there or the user is asking about what was actually said in a conversation, use **scope: sessions** or **scope: both** (see **session-logs** for when sessions are better).
- You also have USER.md and IDENTITY.md in your workspace; read them when relevant. Prefer existing notes and summaries over guessing or starting from scratch.

**Don't search first:**
- For current codebase structure (use your file/code tools to explore first)
- For information already in the current conversation
- Before understanding what the user is asking you to do

## After finding relevant context

Synthesize what you found and give the user actionable guidance. If you didn't find anything relevant, say so and proceed with your best judgment — but always check when the situation above applies.
