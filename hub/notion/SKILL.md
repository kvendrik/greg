---
name: notion-cli
description: Run and use Notion CLI in hub/notion to search pages, get page JSON, and export page contents as Markdown. Use when the user wants to query Notion, fetch a page, or get Notion content as Markdown.
---

# Hub Notion CLI

CLI in `hub/notion` for the Notion API. Run from the **project root** with `bun`.

## Requirements

- **NOTION_API_KEY** must be set (env or `.env`). User gets it from Notion integration settings.

## How to run

From repo root:

```bash
bun run hub/notion -- <command> [options] [args]
```

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

### get \<page-id\>

Retrieve a single page as raw JSON. Page ID can include or omit hyphens.

```bash
bun run hub/notion -- get <page-id>
```

### contents \<page-id\>

Print page contents as **Markdown** (blocks and nested children). Line numbers in options are **1-based**.

```bash
bun run hub/notion -- contents <page-id>
bun run hub/notion -- contents <page-id> --from 10 --lines 20
```

| Option             | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `--from <number>`  | Start from this 1-based line in the rendered Markdown |
| `--lines <number>` | Max number of lines to print                          |

## Notes

- Pagination for `search` is not implemented; "more results" is mentioned in stderr if applicable.
- Use `contents` when the user needs readable page text or Markdown; use `get` when they need full API JSON.
