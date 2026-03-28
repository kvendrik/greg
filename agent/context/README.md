## Why compact

Models lose recall accuracy as context grows ([context rot](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Quality can degrade well before hitting the hard token limit ([OpenAI cookbook](https://cookbook.openai.com/examples/context_summarization_with_realtime_api)). The evidence-backed strategy is: **summarize the older prefix, keep recent turns verbatim** ([Anthropic compaction docs](https://docs.anthropic.com/en/docs/build-with-claude/compaction), [LangChain summary-buffer](https://lagnchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).

## Flow

1. **Trigger** — check thresholds each turn (cache write cost, cache write tokens, soft token limit). First match fires compaction. This mirrors Anthropic's token-threshold trigger and OpenAI's `compact_threshold`.
2. **Split** — find the boundary between "prefix to summarize" and "tail to preserve." Try keeping 5 recent user turns, then 3, then 1, each checked against a token budget (40% of context window). Falls back to the largest token-bounded suffix that fits. Token-bounded retention follows the LangChain `max_token_limit` pattern.
3. **Summarize** — send the prefix to the LLM with a summarization prompt. Custom instructions (from `/compact <instructions>`) replace the default prompt, matching Anthropic's `instructions` parameter behavior.
4. **Reassemble** — `[Compaction summary]` message + preserved tail replaces the full history.

Anthropic's Claude Code uses the same shape: compressed context + the N most recently accessed items ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

## API

```ts
import { compact } from './context';
import { usage } from './context';

// --- compact() ---
const { messages: newMessages, didCompact, reason } = await compact(messages, {
  model,           // { model: Model<Api>, key: string }
  signal,          // optional AbortSignal
  instructions,    // optional string passed to the summarizer
  force: false,    // true bypasses threshold checks (used by /compact)
});

// --- usage() ---
const ctx = usage(messages);
ctx.tokens.used;            // current context tokens
ctx.tokens.window;          // model context window
ctx.tokens.limit;           // soft compaction threshold
ctx.tokens.percentageLimit; // how full the soft limit is (0-100)
ctx.cost.session.total;     // cumulative session cost in USD
```
