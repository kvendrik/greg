---
name: notion-cli
description: Run and use Notion CLI in hub/notion to search pages, get page JSON, and export page contents as Markdown. Use when the user wants to query Notion, fetch a page, or get Notion content as Markdown.
requires:
  - env:NOTION_API_KEY
---

# Hub Notion CLI

CLI in `hub/notion` for the Notion API. Run from the **project root** with `bun`.

## When to use this skill

Use this skill when the user:

- Wants to **search for Notion pages or databases** by title or keyword.
- Needs the **raw JSON** for a specific page.
- Wants the **contents of a Notion page as Markdown** for reading, editing, or exporting.

Do **not** use this skill when:

- The user is asking about Notion concepts in general (how to design a database, templates, etc.) without needing live data.
- The user does not have a Notion integration or has not shared the relevant pages/databases with it.

Prefer returning **short, readable summaries or Markdown snippets**, and only return full JSON when the user explicitly asks.

## Requirements

- **NOTION_API_KEY** must be set (env or `.env`). User gets it from Notion integration settings.

If `NOTION_API_KEY` is missing or invalid:

- Tell the user clearly that the Notion CLI cannot run.
- Explain that they need to create a Notion integration and set `NOTION_API_KEY`.
- Do not keep retrying failing commands.

## How to run

From repo root:

```bash
bun run hub/notion -- <command> [options] [args]
```

Before running the CLI:

- Briefly tell the user which command you are calling and what you expect to retrieve.
- If results might be large, say that you will **summarize or truncate** the output.

## Commands

### search

Search pages (and optionally databases) shared with the integration. Output: `page-id\tTitle` per line.

```bash
bun run hub/notion -- search
bun run hub/notion -- search -q "my query"
bun run hub/notion -- search --page-only
bun run hub/notion -- search -n 50
```

| Option                     | Description                           |
| -------------------------- | ------------------------------------- |
| `-q, --query <string>`     | Filter by title                       |
| `--page-only`              | Return only pages (exclude databases) |
| `-n, --page-size <number>` | Max results 1–100 (default 100)       |

**Typical flows:**

- **"Find my project brief in Notion"**
  1. Run `search -q "<keywords>" --page-only`.
  2. Show the user the top 5–10 matches with:
     - Page ID
     - Title
  3. Ask which page they care about, or pick the most obvious and say what you chose.

- **"List all pages related to X"**
  1. Run `search -q "<X>" --page-only -n 50`.
  2. Group results logically if needed (e.g. by title prefix or database).

### get \<page-id\>

Retrieve a single page as raw JSON. Page ID can include or omit hyphens.

```bash
bun run hub/notion -- get <page-id>
```

Use this when the user explicitly wants **raw Notion page JSON** (for debugging or automation).

When returning data:

- Prefer a **short explanation** of the structure before showing any JSON.
- If the JSON is large, show only the most relevant subsections or instruct the user how to run the command locally.

### contents \<page-id\>

Print page contents as **Markdown** (blocks and nested children). Line numbers in options are **1-based**.

**Notion pages can be very large.** To avoid loading massive amounts of text at once, **prefer reading in chunks** using `--from` and `--lines`. For example: start with the first 50–100 lines; if the user needs more or a specific section, run another `contents` call with the appropriate `--from` and `--lines`.

```bash
bun run hub/notion -- contents <page-id>
bun run hub/notion -- contents <page-id> --from 1 --lines 50
bun run hub/notion -- contents <page-id> --from 51 --lines 50
```

| Option             | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `--from <number>`  | Start from this 1-based line in the rendered Markdown |
| `--lines <number>` | Max number of lines to print                          |

**Typical flows:**

- **"Show me the contents of this Notion page"**
  1. Run `contents <page-id> --from 1 --lines <N>` (e.g. 50–100 lines) to get the first chunk.
  2. Return the Markdown inside a fenced code block. Say how many lines were shown and that more is available if needed.
  3. If the user asks for more or a specific part, run `contents` again with the right `--from` and `--lines`.

- **"Show just the middle of a long page"**
  1. Decide a sensible `--from` and `--lines` range based on what the user asked for.
  2. Run `contents <page-id> --from <start> --lines <count>`.
  3. Tell the user which slice they are seeing and how to get more.

## Notes

- **Large pages:** Use `--from` and `--lines` with `contents` to read in chunks; do not load entire large pages in one go.
- Pagination for `search` is not implemented; "more results" is mentioned in stderr if applicable.
- Use `contents` when the user needs readable page text or Markdown; use `get` when they need full API JSON.
- If a page or database is not shared with the integration, the API will behave as if it does not exist; explain this to the user and suggest sharing the page with the integration.
