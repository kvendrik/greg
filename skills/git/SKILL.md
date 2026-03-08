---
name: git
description: General Git helper for inspecting status, creating commits, and safely pushing changes in any git repository. Always ask before committing or pushing.
---

# General Git skill

Use this skill in **any project that is a git repo** when the user asks about Git status, diffs, commits, branches, or pushing changes (including phrases like “commit this”, “save my work”, “push it up”, “get this into GitHub”, etc.).

This skill is **not just for pushing**; it should guide and (if permitted) run the full Git workflow:

- Inspect status and diffs
- Help the user decide what to stage and commit
- Create commits (only after explicit confirmation)
- Push commits (only after explicit confirmation)
- Explain and recommend safe Git commands when unsure

## Always ask before committing

Before running **any** `git commit` command for changes made in this session:

1. **Summarize changes**  
   - Run `git status -sb` and briefly describe what has changed (modified, added, deleted files).
   - If helpful, show a short `git diff --stat` or specific diffs the user asked for.

2. **Confirm commit explicitly**  
   - Ask the user something like:  
     - “I’ve made these changes. **Do you want me to create a git commit with these changes now? (yes/no)**”  
   - Only run `git commit` if the user **clearly says yes** or explicitly asks you to “commit” in response to that prompt.
   - If the user says no or is unsure, **do not commit**. Instead, show them the exact commands they can run themselves.

3. **Commit message guidance**  
   - Suggest a clear, imperative, one-line subject (e.g. `Add browser-use skill` or `Fix CLI prompt handling`).
   - If the user doesn’t care, you can pick a reasonable message and state it before running the command.
   - For a more structured style, use **conventional commits** (see below).

## Conventional commit messages (optional)

When the user is happy with conventional commits or you want to suggest them, use this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Common types:** `feat` (new feature), `fix` (bug fix), `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

**Workflow:** Run `git diff --staged` (or `git diff` if nothing staged) and `git status --porcelain` to see what changed. From the diff, choose **type**, optional **scope** (e.g. module or area), and a **description** in present tense, imperative mood, under 72 characters. Example: `feat(guard): handle classifier unreachable gracefully`.

**Best practices:** One logical change per commit; present tense ("add" not "added"); imperative ("fix bug" not "fixes bug"); reference issues in footer with `Closes #123` or `Refs #456`.

## Always ask before pushing

Before running **any** `git push` command:

1. **Explain what will be pushed**  
   - Show current branch and remote tracking info:  
     - `git status -sb` or `git branch -vv`
   - Briefly state: “You are on branch `<branch>` which will be pushed to `<remote>/<branch>`.”

2. **Confirm push explicitly**  
   - Ask the user something like:  
     - “Do you want me to **push these commits** to `<remote>/<branch>` now? (yes/no)”  
   - This confirmation is required **even if** the user initially said things like “push changes”, “push it up”, or “commit and push” — you should still double-check before actually pushing.
   - Only run `git push` if the user clearly says yes to this push confirmation.

3. **If user declines push**  
   - Do not push.
   - Show the exact command they can run later, e.g. `git push` or `git push origin <branch>`.

## Common workflows

When helping the user with Git, follow these general patterns.

### 1. Inspect the repo

1. Run `git status -sb` to see current branch and a short summary of changes.
2. Use `git diff` or `git diff -- <path>` to show detailed changes when the user asks.
3. If there are untracked files, point them out and ask whether they should be included.

### 2. Stage changes

- Prefer staging only what the user intends:
  - `git add <paths>` for specific files.
  - `git add -p` when changes in a file should be split across commits.
- Only use `git add -A` when the user clearly wants **everything** staged.

### 3. Create a commit (after confirmation)

Once the user has confirmed they want a commit:

1. Ensure the correct files are staged: `git status -sb`.
2. Create the commit with a clear subject, e.g.:  
   - `git commit -m "Add telegram messaging skill"`  
3. If commit fails due to hooks or other issues, show the error and explain next steps rather than trying risky workarounds.

### 4. Push commits (after separate confirmation)

Once there are commits to push and the user has explicitly confirmed the push:

1. For a branch that already tracks a remote:  
   - `git push`
2. For a new branch:  
   - `git push -u origin <branch>`
3. If the push is rejected (non-fast-forward, etc.):
   - Explain what happened and suggest a safe sequence like `git fetch` followed by `git pull --rebase` **before** retrying, or ask the user how they want to handle it.

## Safety rules

- **Do not change Git configuration** (e.g. `git config --global`) unless the user explicitly asks and understands the impact.
- **Never run destructive history commands** (`git push --force`, `git reset --hard`, aggressive rebases) unless the user explicitly requests them and you have clearly described the risks.
- **Never assume implicit permission to commit or push** just from general language; always perform the explicit confirmations described above.
- **Never skip hooks** (e.g. `--no-verify`) unless the user explicitly asks. If a commit fails due to hooks, fix the issue and create a new commit; do not amend to bypass.
- **Never force push to main/master** unless the user explicitly requests it and understands the impact.
- If you lack permission to write to the repo (e.g. no `git_write` capability), **do not attempt to push**. Instead, show the user the exact commands they should run locally.
## When to use this skill

Use this skill in **any project that is a git repo** when the user asks about Git status, diffs, commits, branches, or pushing changes (including phrases like “commit this”, “save my work”, “push it up”, “get this into GitHub”, etc.).

Do **not** use this skill when:

- The repository is in the middle of an interactive operation (e.g. rebase, merge) that you do not fully understand—ask the user before touching git.
- The user has not asked for git help and only wants code changes.

This skill is **not just for pushing**; it should guide and (if permitted) run the full Git workflow:

- Inspect status and diffs.
- Help the user decide what to stage and commit.
- Create commits (only after explicit confirmation).
- Push commits (only after explicit confirmation).
- Explain and recommend safe Git commands when unsure.
