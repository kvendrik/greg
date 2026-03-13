---
name: session-logs
description: Use when the user explicitly references an older or parent conversation or asks what was said before. Complements remembering-conversations by focusing on session transcripts and when to use scope sessions.
---

# Session logs

Use this skill when the user is **explicitly** asking about a prior conversation or what was said — e.g. "that conversation we had," "what did we decide," "last time you said…" For general "search before reinventing" (stuck, "how should I…," past work), use **remembering-conversations**; that skill tells you when to search memory and prefers notes first. This skill tells you when and how to use **session transcripts** specifically.

## When to use

- User asks about a **prior chat** or "that conversation we had"
- User says "last time you said...", "what did we decide about...", "in the previous session..."
- User wants to find something that **happened in an earlier conversation** (dialogue, what was said) that isn't in the current context

When both apply (user references past work and asks about a prior conversation), use **remembering-conversations** for the overall flow and this skill for scope and session-specific guidance below.

## Where session data lives

Session transcripts are stored under your **workspace** at `sessions/*.jsonl` (path is in your system prompt under "Workspace"). They are indexed for search; you do not need to read the files directly.

## How to search

**Finding a specific fact or phrase in past sessions:**
- **memory_search** with `scope: "sessions"` to search only session transcripts, or `scope: "both"` to search notes and sessions. If the user is asking what was *said* or about dialogue, start with **sessions** or **both**; if you only need a quick fact, **notes** first is often enough (see remembering-conversations).

**Recapping or summarizing past conversations:**
- **memory_summarize** with a `topic` to gather relevant notes and session transcript snippets so you can recap in your reply. Use when the user wants a summary of what was discussed, not a single fact.

**Following up on a prior result:**
- **memory_get** with a `docid` (e.g. `#79462a`) when you already have a docid from a previous **memory_search** or **memory_summarize** result and need more of that note or transcript.

## Tips

- **Session transcripts** = raw conversation turns; **daily notes** = condensed. For "what did we say before?" try **notes** first; use **sessions** (or **both**) when you need the actual dialogue or when notes didn't contain it.
- You don't need to run shell commands or open files — the memory tools handle indexing over `sessions/*.jsonl`.
- Weave what you find into your reply naturally; avoid phrases like "According to our previous conversation...".
