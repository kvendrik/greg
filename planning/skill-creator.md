# Skills Autoresearch

Adds a generate-evaluate-refine loop to skill creation and improvement. For each eval, a subagent runs the skill in a clean context, Greg reviews the transcript and output, presents results to the user, and iterates based on feedback.

## Today

Greg has a skill-creator today but it's purely conversational: draft a skill, save it, suggest the user try it, iterate on description/body based on vibes. There's no structured evaluation, no way to know if a change actually helped.

## How it works

### 1. Draft the skill (existing flow)

Capture intent, interview user, write SKILL.md, save with `save_skill`. No changes here.

### 2. Define test cases

After drafting, write 2-5 realistic test prompts -- the kind of thing a real user would say that should trigger the skill. Save them alongside the skill:

```
skills/my-skill/
├── SKILL.md
└── evals.json
```

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "realistic user prompt that should trigger this skill",
      "expected_output": "description of what good looks like",
      "assertions": []
    }
  ]
}
```

Assertions are optional and added after the first run. They're objectively verifiable checks (e.g. "output contains X", "file was created", "command was run"). Subjective skills (writing style, tone) skip assertions and rely on human review.

### 3. Run test cases

For each eval, `spawn_agent` a subagent (name: `eval-agent-[skill_name]`) with the skill injected into its system prompt and give it the test prompt via `prompt_agent`. Each subagent runs in a clean context -- no bleed from the parent conversation or other evals.

The skill is injected directly into the subagent's system prompt (not via the `<available_skills>` discovery mechanism). This tests whether the skill's instructions produce good output, not whether the description triggers correctly -- trigger tuning is a separate step (see step 6).

The subagent should get the tools the skill needs. Greg determines this from the skill content (e.g. a skill that runs CLI commands needs `exec`, one that writes files needs `files`). When unclear, default to `exec` and `files`.

Run evals one at a time (simpler to present results per-eval as they come in and easier to handle errors). When each subagent finishes (via background update), use `get_agent_messages` to read the full transcript, save the output, then `destroy_agent` to clean up:

```
skills/my-skill/
├── SKILL.md
├── evals.json
└── iterations/
    └── 1/
        ├── eval-1.md
        └── eval-2.md
```

Each `eval-N.md` contains the prompt, the subagent's full output, and assertion results if applicable.

### 4. Present results inline

Show each eval's prompt and output directly in the conversation. If assertions exist, show pass/fail. For each eval, ask for feedback: "How does this look? Anything you'd change?"

The user responds with corrections or "looks good". Empty/positive feedback = that eval is fine.

### 5. Improve and repeat

Based on feedback, improve the skill. Key principles (from Anthropic's skill-creator):

- **Generalize from feedback.** The skill will be used across many prompts. Don't overfit to the test cases -- if something is stubborn, try different metaphors or patterns rather than adding rigid MUSTs.
- **Keep the prompt lean.** If the skill causes unproductive work, remove those instructions.
- **Explain the why.** Instead of heavy-handed ALWAYS/NEVER rules, explain reasoning so the model understands intent. If you're writing in all caps, that's a yellow flag -- reframe with reasoning.
- **Read the transcripts, not just outputs.** Use `get_agent_messages` to see how the subagent actually followed the skill. If it wasted time on unproductive steps, trim those instructions. If it independently invented the same helper approach across multiple evals, bake that approach into the skill.

After improving:

1. Update the skill with `save_skill`
2. Delete the previous iteration directory, re-run all evals into a new `iteration-N/`
3. Present results again, noting what changed from last iteration
4. Repeat until the user is happy or 3 iterations pass with the same feedback (suggest stopping)

### 6. Description optimization (trigger tuning)

Separate from the eval loop. After the skill itself is good, optimize when it triggers:

1. Generate ~20 eval queries: mix of should-trigger (8-10) and should-not-trigger (8-10). Focus on near-misses for the negatives -- not obviously irrelevant prompts.
2. User reviews and edits the list.
3. For each query, spawn a subagent with all skills loaded (via the normal `<available_skills>` mechanism) and prompt it with the eval query. After the subagent finishes, read its transcript via `get_agent_messages` and check whether it `cat`'d the target skill's location. If it did, the skill triggered. Destroy the subagent after each check.
4. Score: count false positives (triggered when it shouldn't) and false negatives (didn't trigger when it should). Adjust the description to reduce both.
5. Repeat up to 3 rounds. Stop when the score stops improving or hits zero failures. Pick the description with the best score.

## What Greg already has

- **Subagents**: `spawn_agent` creates isolated agents with their own system prompt, model, and tool subset (`web_search`, `web_fetch`, `exec`, `files`). `prompt_agent` sends a prompt (fire-and-forget, result comes via background update). `get_agent_messages` retrieves the full transcript.
- **`save_skill`**: creates/updates SKILL.md with frontmatter + body.
- **`discoverSkills`**: scans `skills/` and workspace `skills/` for SKILL.md files, parses frontmatter, returns metadata.
- **Skill instructions in system prompt**: `<available_skills>` list with name, description, location. Model reads full skill on demand.
- **Exec tool**: can run scripts for programmatic assertion checking.
- **File tools**: can write evals.json, output files, etc.

## What needs to be built

### Skill: update `skills/skill-creator/SKILL.md`

The existing skill-creator skill needs to be updated with the eval loop instructions. This is the primary deliverable -- the skill tells Greg _how_ to run the loop using its existing tools.

The skill should cover:

- When to run evals (after drafting, after each edit)
- How to write good test prompts (realistic, varied phrasing, edge cases)
- How to execute: spawn a subagent per eval with the skill injected, read transcript when done
- How to pick tools for the subagent based on skill content
- How to present results inline and collect feedback
- The improvement philosophy (generalize, keep lean, explain why, read transcripts)
- The iteration loop (stop after 3 iterations with same feedback)
- Description optimization as a separate final step

## Future

- **Baselines**: when improving a skill, run both old and new versions in parallel and compare. Snapshot the old SKILL.md before editing, spawn two subagents per eval.
- **Quantitative benchmarking**: capture token count, duration, pass rates with mean/stddev across runs.
- **Blind comparison**: a separate agent judges two outputs without knowing which version produced them (like Claude Code's comparator agents).

## Decisions

- **Iteration cleanup**: only keep the latest iteration directory. Delete previous iterations before running a new one. evals.json is permanent, iteration results are ephemeral.
- **Skill injection**: inject the skill directly into the subagent's system prompt for eval runs (not via `<available_skills>`). This isolates testing the skill's instructions from testing the description's triggering.
- **Subagent tools**: determined from skill content. Default to `exec` + `files` when unclear.
- **Stopping**: suggest stopping after 3 iterations with the same unresolved feedback.
