---
name: greg-repo-push
description: Pushes changes to the Greg repository. Use when the user asks to push changes, commit and push, or get changes up to the repo for Greg itself.
---

# Pushing changes to the Greg repo

When the user wants to push changes to the Greg (pa-agent) repository:

1. **Check status**  
   Run `git status` in the project root to see what’s changed and which branch you’re on.

2. **Stage**  
   Stage the files to include:
   - `git add <paths>` for specific files, or
   - `git add -A` to stage everything (only if the user intends to commit all changes).

3. **Commit**  
   Commit with a clear, descriptive message:
   - Use present tense, e.g. `Add browser-use skill` or `Fix CLI prompt handling`.
   - One concise line is enough; add a short body only if it helps.

4. **Push**  
   Push to the remote:
   - `git push` (or `git push origin <branch>` if not on the default branch).
   - If the branch is ahead of `origin`, this updates the remote with the new commits.

**Notes**

- Confirm with the user before running `git push` if they asked to “push changes” and you’re about to push for the first time in the conversation.
- If the user said “push my changes” or “push it up”, they have already decided; go ahead and run the steps.
- Do not push if you don’t have permission to write to the repo (e.g. no `git_write` or equivalent); tell the user what commands they need to run instead.
