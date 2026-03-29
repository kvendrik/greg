# 🤖 `compact()`

#### A context compaction toolkit for [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai)

```
bun add @kvendrik/compact
```

```ts
import { compact } from '@kvendrik/compact';

const {
  messages: newMessages,
  didCompact,
  reason,
} = await compact(messages, {
  model, // { model: Model<Api>, key: string }
  signal, // optional AbortSignal
  instructions, // optional summarization instructions: { content: string; strategy: 'replace' | 'append' }
  force: false, // true bypasses threshold checks
});
```

## Why

Compaction makes it possible to talk to your agent indefinitely. When your context window hits a certain size you summarize everything you've spoken about and present the agent with the summarization so that you can keep chatting.

When summarization should occur and how exactly it works can be a bit tricky to get right. That's why I'm sharing [Greg’s](https://github.com/kvendrik/greg) compaction toolkit, which combines a bunch of evidence-based strategies for effective compaction.

## Where this fits in

Both [Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/compaction) and [OpenAI](https://developers.openai.com/api/docs/guides/context-management) offer server-side compaction APIs, and [`pi-coding-agent`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) ships its own compaction logic tied to its own `SessionManager`. This library is for developers building on [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) directly — without `pi-coding-agent` session management — who want client-side compaction with evidence-based defaults.

> As a side-note. If you’re looking into compaction systems you might also be interested in [OpenClaw’s compaction logic](https://github.com/openclaw/openclaw/blob/main/src/agents/compaction.ts) which is also written for `pi` and similar to this library’s logic.

## Strategies

- **Keep summaries intact** — every summarization pass discards detail. We never re-summarize existing summaries; they're preserved as-is and new summaries are added alongside them ([LangChain `moving_summary_buffer`](https://langchain-doc.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).
- **Keep recent turns verbatim** — the most recent exchanges carry the highest signal. Summarize the older prefix, never the tail ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [LangChain summary-buffer](https://langchain-doc.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)). Anthropic's Claude Code uses the same shape: compressed context + the N most recently accessed items ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Use cost as a secondary signal** — large cache write costs indicate a bloated context even if token counts look fine. We use cost thresholds alongside token thresholds ([Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)).
- **Compact before hitting the hard limit** — model recall drops well before the hard context window. Compact proactively at a soft threshold, not at the edge ([OpenAI cookbook](https://cookbook.openai.com/examples/context_summarization_with_realtime_api), [Anthropic post on compaction](https://docs.anthropic.com/en/docs/build-with-claude/compaction), [Anthropic post on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Don't summarize old tool call results** — raw tool output is useful when fresh but redundant once acted on. Clearing old results is the lightest-touch compaction step ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

## What you should know

**Compaction alone has a ceiling** — Anthropic describes three complementary strategies: compaction, structured note-taking outside the context window, and sub-agents with clean windows ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). [Greg](https://github.com/kvendrik/greg) covers all three: `compact` handles in-window summarization, `memory_note` persists decisions and context to disk, and `spawn_agent` delegates long-running tasks to sub-agents with their own sessions.

## Flow

When you call `compact()`:

1. **`checkLimit()`** — checks thresholds (cache write cost, cache write tokens, soft token limit). First match fires a `reached: true`. This mirrors Anthropic's token-threshold trigger and OpenAI's `compact_threshold`.
2. **`split()`** — finds the boundary between "prefix to summarize" and "tail to preserve." We try to keep 5 recent user turns, then 3, then 1, each checked against a token budget (40% of context window). Falls back to the largest token-bounded suffix that fits. Token-bounded retention follows the LangChain `max_token_limit` pattern.
3. **`summarize()`** — sends the messages to compact to the LLM with a summarization prompt. Custom instructions replace the default prompt (when `instructions.strategy` is set to `replace`), matching Anthropic's `instructions` parameter behavior.
4. **Reassemble** — We put together the messages to preserve from `split()` and the `summary` for a new array of messages.

## Manual API

```ts
import type { Model, Api } from '@mariozechner/pi-ai';
import { checkLimit, split, summarize } from '@kvendrik/compact';

const model: {model: Model<Api>, key: string} = {...};
const messages: AgentMessage[] = [];

const limit = checkLimit(messages, {model: model.model});

if (limit.reached) {
  console.log(`Limit reached: ${limit.reason}.`);

  const { compact, preserve } = split(messages, model.model);
  if (compact == null) return messages;

  const compacted = await summarize(compact, {
    model,
    signal: new AbortController().signal,
  });

  return [...compacted, ...preserve];
}

return messages;
```
