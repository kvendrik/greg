---
name: session-logs
description: Search and use past session transcripts when the user references older or parent conversations or asks what was said before. Use memory tools over workspace/sessions/*.jsonl; no CLI required.
---

# Session logs

Search your conversation history stored in session transcript files. Use this skill when the user references older or parent conversations, or asks what was said before.

## When to use

- User asks about a prior chat or "that conversation we had"
- User says "last time you said...", "what did we decide about...", "in the previous session..."
- User wants to find something that happened in an earlier conversation that isn’t in the current context or in daily notes

## Where session data lives

Session transcripts are stored under your **workspace** at `sessions/*.jsonl` (full path is in your system prompt under "Workspace"). They are indexed for search; you do not need to read the files directly.

## How to search in Greg

Use your **memory tools** — they already index both daily notes and session transcripts:

**Finding a specific fact or phrase in past sessions:**
- **`memory_search`** with `scope: "sessions"` to search only session transcripts, or `scope: "both"` to search notes and sessions. Use when the user is looking for something concrete (a decision, a name, a topic). Prefer `scope: "notes"` first (notes are condensed from sessions); if the answer isn’t there, call again with `scope: "sessions"` or `scope: "both"`.

**Recapping or summarizing past conversations:**
- **`memory_summarize`** with a `topic` to gather relevant notes and session transcript snippets so you can recap in your reply. Use when the user wants a summary of what was discussed, not a single fact.

**Following up on a prior result:**
- **`memory_get`** with a `docid` (e.g. `#79462a`) when you already have a docid from a previous `memory_search` or `memory_summarize` result and need more of that note or transcript.

## Tips

- Session transcripts are raw conversation turns; daily notes are condensed. For "what did we say before?" often **notes** (scope `notes` or default) are enough; use **sessions** when you need the actual dialogue or when notes didn’t contain it.
- You don’t need to run shell commands or open files — the memory tools handle indexing and search over `sessions/*.jsonl`.
- Weave what you find into your reply naturally; avoid phrases like "According to our previous conversation...".
