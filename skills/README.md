# Greg skills

Skills are Markdown files in `SKILL.md` inside each subdirectory. Greg discovers them from the project `skills/` directory and the workspace `skills/` directory (workspace overrides project when the same skill name exists).

## Tier 1 OpenClaw skill additions

These are the recommended first skills to add from [LeoYeAI/openclaw-master-skills](https://github.com/LeoYeAI/openclaw-master-skills). They align with Greg’s role as a personal assistant with memory, tools, and skill-writing.

| OpenClaw skill      | Copy as (folder + frontmatter `name`) | Why |
|---------------------|--------------------------------------|-----|
| `writing-skills`    | `openclaw-writing-skills`            | Teaches when/how to create and edit skills; complements `save_skill`. |
| `using-superpowers`  | `openclaw-using-superpowers`         | How to find and use skills; matches Greg’s “read from &lt;location&gt;” flow. |
| `remembering-conversations` | `openclaw-remembering-conversations` | Reuse past conversations; fits Greg’s memory and notes. |
| `skill-creator`     | `openclaw-skill-creator`             | Create, refine, and measure skills (Anthropic). |
| `docx`              | `openclaw-docx`                      | Create, read, edit Word documents. |
| `pdf`               | `openclaw-pdf`                       | Read, edit, merge PDFs. |
| `xlsx`              | `openclaw-xlsx`                      | Spreadsheets as input/output. |

**Do not add** OpenClaw’s `git-commit` as a separate skill: the project already has a `git` skill. To adopt conventional-commit style, extend `skills/git/SKILL.md` instead.

### How to add Tier 1 skills

1. Clone OpenClaw master skills once:
   ```bash
   git clone https://github.com/LeoYeAI/openclaw-master-skills.git
   ```

2. Copy each skill with the `openclaw-` prefix (from repo root):
   ```bash
   for skill in writing-skills using-superpowers remembering-conversations skill-creator docx pdf xlsx; do
     cp -r openclaw-master-skills/skills/$skill skills/openclaw-$skill
   done
   ```

3. In each `skills/openclaw-*/SKILL.md`, set the frontmatter `name` to the same as the folder (e.g. `name: openclaw-writing-skills`) so the skill list shows a consistent name and avoids clashes with any future local skill.

4. Run `greg memory index` if you use memory indexing, then `greg restart` so the agent sees the new skills.

---

## Avoiding duplicate skills

- **Naming**: Imported OpenClaw skills use the **`openclaw-` prefix** (folder and frontmatter `name`). Local skills (e.g. `git`, `jobs-cli`, `telegram-messaging`) stay unprefixed.
- **Discovery**: If the same skill `name` appears in both project and workspace, **workspace wins** (only one entry is shown).
- **Curating**: Before adding an OpenClaw skill, check this README and the list above. If we already have a local skill that covers the same use case (e.g. `git`), either extend the local skill or add the OpenClaw one with the prefix and a distinct purpose (e.g. we do not add `git-commit`; we keep one `git` skill).

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
