# Greg skills

Skills are Markdown files in `SKILL.md` inside each subdirectory. Greg discovers them from the project `skills/` directory and the workspace `skills/` directory (workspace overrides project when the same skill name exists).

## Tier 1 skills (added)

The following skills from [LeoYeAI/openclaw-master-skills](https://github.com/LeoYeAI/openclaw-master-skills) are included without an `openclaw-` prefix. Some are adapted for Greg (e.g. using workspace memory instead of subagents, or reading skill files via `cat` instead of a Skill tool).

| Skill | Notes |
|-------|--------|
| `writing-skills` | When/how to create and edit skills; Greg-adapted (save_skill, skills/ dir). |
| `using-superpowers` | How to find and use skills; Greg-adapted (read from location, red flags, priority). |
| `remembering-conversations` | Reuse past conversations; Greg-adapted (workspace memory and notes, no subagent). |
| `skill-creator` | Create or improve skills; Greg-adapted (no eval runner, iterate with user feedback). |
| `docx` | Create, read, edit Word documents (from OpenClaw). |
| `pdf` | Read, edit, merge PDFs (from OpenClaw). |
| `xlsx` | Spreadsheets as input/output (from OpenClaw). |

**git:** The existing `git` skill was updated with conventional commit format, types, workflow, and safety rules from OpenClaw's `git-commit`. We do not add `git-commit` as a separate skill.

To add more skills from OpenClaw: clone the repo, copy `skills/<name>` into this `skills/` directory (no prefix unless you want to avoid name clashes), and run `greg memory index` and `greg restart` if needed.

---

## Avoiding duplicate skills

- **Discovery**: If the same skill `name` appears in both project and workspace, **workspace wins** (only one entry is shown).
- **Curating**: Before adding a skill from OpenClaw, check this README. If we already have a local skill for the same use case (e.g. `git`), extend the local skill instead of adding a second one (e.g. we merged `git-commit` into `git`).
- **Optional prefix**: If you add an OpenClaw skill that might clash with a future local skill, use a prefix (e.g. `openclaw-<name>`) for the folder and frontmatter `name`.

---

## Skills that depend on external CLIs or env

Some skills assume a CLI or environment variable is available (e.g. `gog` for Google, `NOTION_API_KEY` for Notion). If the user hasn’t installed or configured them, the skill will fail when used.

**What we do:**

1. **Document in the skill**  
   Each such skill has a “Requirements” or “Before using” section that states the CLI and/or env (see e.g. `google-cli`, `notion-cli`, `strava-cli`). Keep that as the source of truth.

2. **Optional frontmatter `requires`**  
   In `SKILL.md` you can add:
   ```yaml
   requires:
     - gog           # CLI: must be on PATH
     - env:GOG_ACCOUNT
     - env:NOTION_API_KEY
   ```
   - Plain entries are treated as CLI names (checked with `which`).
   - `env:VAR` entries are treated as required environment variables.

3. **`greg doctor`**  
   Run `greg doctor` to validate config and check skill dependencies: for each skill that has `requires`, Greg checks that the CLIs exist and (for `env:VAR`) that the variables are set. Missing requirements are reported as **warnings** (skills are optional); only config validation failures cause a non-zero exit. If a skill's requirements are not met, Greg will not use that skill and will inform the user and suggest `greg doctor`.

If a skill needs a CLI that isn’t installed, the skill text should tell the user how to install it (e.g. “Install with `brew install steipete/tap/gogcli`”) and to run `greg doctor` to verify the environment.
