---
name: agent-council
description: 'Use when the user asks to convene a council, get multiple perspectives, debate a topic, or wants agents to discuss and reach consensus on a question, decision, or design.'
---

# Agent Council

Spawn a panel of sub-agents with distinct perspectives, run structured debate rounds, and produce a final answer. You are the **moderator** — you relay messages between members and produce the final output.

## When to use

- The user wants multiple viewpoints on a decision, design, or question.
- The user explicitly asks for a "council", "debate", "panel", or "multiple perspectives".
- A problem benefits from adversarial or diverse reasoning (architecture trade-offs, risk analysis, strategy).

## When NOT to use

- Simple factual lookups or single-step tasks.
- The user wants fast, not thorough.

## Choosing a decision protocol

Pick the protocol based on the task type. This matters — the wrong protocol can cost over 10% accuracy.

| Task type                                                  | Protocol                                                                     | Why                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Reasoning** (logic, math, strategy, code design)         | **Voting** — each agent submits a final answer, moderator picks the majority | Voting lets agents explore independent reasoning paths (+13.2% over consensus on reasoning)             |
| **Knowledge** (factual recall, domain expertise, research) | **Consensus** — agents converge on a shared answer through debate            | Consensus catches small factual errors through repeated cross-checking (+2.8% over voting on knowledge) |

When unsure, default to **voting** — it's more robust and faster to resolve.

## Council roles

Pick 2–4 roles that create useful tension for the topic. Examples:

| Topic type   | Example roles                               |
| ------------ | ------------------------------------------- |
| Architecture | Pragmatist, Purist, Security Advocate       |
| Strategy     | Optimist, Skeptic, Risk Analyst             |
| Research     | Domain Expert, Generalist, Devil's Advocate |
| Code review  | Performance, Readability, Correctness       |
| Code editing | Feature Author, Reviewer, Test Writer       |

Each role gets a system prompt that defines its perspective. Keep prompts short (2–4 sentences). Include: who they are, what they value, and that they should **hold their ground when they have strong arguments** rather than agreeing with the majority.

## Process

### 1. Spawn council members

For each role, call `spawn_agent` with:

- **name**: a fun, human-like name that fits the role (e.g. `frank` for a blunt pragmatist, `sage` for a domain expert, `nitpick` for a code reviewer)
- **emoji**: something fitting the role
- **systemPrompt**: the role definition (see template below)
- **model**: assign **different models** to different members when multiple are available — diverse models produce better outcomes than multiple instances of the same model
- **tools**: `["web_search", "web_fetch"]` — add `exec` for shell access, `files` for reading/editing code

**System prompt template:**

```
You are the {Role} on a council of advisors. You value {values}.

Rules:
- State your confidence (high / medium / low) with every position you take.
- When presented with other arguments, critique them and refine your position.
- Do NOT agree with the majority just because they outnumber you. Hold your ground when you have strong arguments.
- Be concise. State your position clearly, then give 2-3 supporting arguments.
```

### 2. Independent drafting (all protocols)

Send the user's question to every council member via `prompt_agent`. Each agent must answer **independently** — do not include any other agent's output or hints in the prompt. This is the most important step: diverse independent starting positions are the primary driver of council quality.

```
The council question is: "{question}"

State your position with 2-3 supporting arguments. State your confidence level (high/medium/low). Be concise.
```

Track how many agents you prompted. Wait until you've received a background update from each one before proceeding. `prompt_agent` is fire-and-forget — updates arrive asynchronously, so count them as they come in.

### 3. Resolve (protocol-dependent)

The next step depends on the protocol chosen in step 0.

#### Voting protocol: skip debate, go straight to selection

**Do not run a debate round for voting.** Research shows that debate before voting reduces performance — agents drift from the original problem and converge on worse answers. Instead, treat this as best-of-N selection:

1. Review all independent positions and their confidence levels.
2. Pick the majority answer. If there's a tie, weight by confidence.
3. Present the winning position with key supporting arguments.

This is faster, cheaper, and more accurate than debate + vote.

#### Consensus protocol: collaborative refinement

For consensus, run one debate round. **Anonymize the responses** — do not attribute positions to named agents. This prevents sycophancy (uncritically adopting a peer's view) and self-bias.

There are two modes. Pick based on intent:

**Adversarial debate** — when the goal is to stress-test ideas and surface disagreements:

```
Here are the other council members' anonymous positions:

Position A: {summary} [confidence: high]
Position B: {summary} [confidence: medium]

Critique these arguments from your perspective. Weight your critique by their stated confidence — high-confidence positions deserve stronger counter-arguments to overturn. Update or strengthen your own position. State your updated confidence.
```

**Collective improvement** — when the goal is to refine and improve the best answer (+7.4% over plain debate in research):

```
Here are the other council members' anonymous positions:

Position A: {summary} [confidence: high]
Position B: {summary} [confidence: medium]

The strongest position appears to be Position {X}. Build on it: fix any weaknesses, incorporate the best ideas from other positions, and produce an improved version. State your confidence in the improved answer.
```

Wait for all responses, then write the synthesis:

1. **Areas of agreement** — what all or most members converged on.
2. **Key disagreements** — where perspectives diverged and why.
3. **Recommendation** — your moderated conclusion, weighing arguments by confidence.
4. **Minority opinion** (if any) — dissenting views worth noting.

Present to the user. Do not run additional rounds unless the user explicitly asks — more rounds degrade quality through problem drift.

### 4. Cleanup

After the council is done, ask the user if they want to keep the agents for follow-up or destroy them with `destroy_agent`.

## Code editing councils

When the council is working on code (refactoring, feature implementation, review), give agents both `files` and `exec` tools. The `files` tool provides `patch_file` for editing, but agents need `exec` (with commands like `cat`, `ls`, `find`) to read files and discover paths.

A typical code council flow:

1. **Feature Author** — implements the change using `patch_file`.
2. **Reviewer** — reads the patched files via `exec` (`cat`), critiques the implementation, suggests improvements.
3. **Test Writer** — writes or updates tests for the change.

In code councils, the consensus protocol with collective improvement works well: the reviewer's feedback goes back to the author who refines, and the test writer adjusts tests based on the final implementation.

## Tips

- **Diversity > quantity.** Using different models for different agents matters more than adding agents. Three diverse models outperform three identical ones (91% vs 82% on reasoning benchmarks). Default to 3 agents.
- **Keep prompts tight.** Verbose system prompts dilute the agent's focus.
- **Anonymize when relaying.** Use "Position A/B/C" not agent names — this reduces identity bias and sycophancy.
- **Summarize when relaying.** Don't dump raw transcripts — summarize each position in 2-3 sentences.
- **Fewer rounds is better.** For voting, zero debate rounds. For consensus, one debate round. More rounds cause problem drift (agents lose track of the original question).
- **Weight by confidence.** When synthesizing or breaking ties, give more weight to high-confidence positions.
