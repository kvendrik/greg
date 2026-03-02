# Notion CLI

CLI to fetch Notion pages using the [Notion API](https://developers.notion.com/). Requires a Notion integration and `NOTION_API_KEY`.

## Setup

1. Create an [integration](https://www.notion.so/my-integrations) in Notion and copy the API key.
2. Share the pages or databases you want to access with that integration (click **•••** on a page → **Connections** → add your integration).
3. Set the key in your environment or a `.env` file:

   ```bash
   export NOTION_API_KEY="your-secret-key"
   ```

## Run

From the project root:

```bash
bun run scripts/tools/notion/notion.ts <command> [options]
```

Or add a script to `package.json` and use e.g. `bun run notion`.

## Commands

### `search`

Search pages and databases shared with your integration. Output is tab-separated: `page-id` then title (or `[object]` for non-pages).

```bash
bun run scripts/tools/notion/notion.ts search
bun run scripts/tools/notion/notion.ts search --query "meeting"
bun run scripts/tools/notion/notion.ts search --page-only -n 20
```

| Option | Description |
|--------|-------------|
| `-q, --query <string>` | Filter by title |
| `--page-only` | Return only pages (exclude databases) |
| `-n, --page-size <number>` | Max results (1–100). Default: 100 |

### `get <page-id>`

Retrieve a single page as raw JSON. Page ID can be with or without hyphens.

```bash
bun run scripts/tools/notion/notion.ts get abc123def456
bun run scripts/tools/notion/notion.ts get abc123-def456-...
```

### `contents <page-id>`

Print the page as **Markdown**: title, then all blocks (headings, paragraphs, lists, to-dos, quotes, images). Images are inlined as base64 data URLs. Line numbers in the output are 1-based (title is line 1, blank line is 2, first block line 3, etc.).

```bash
bun run scripts/tools/notion/notion.ts contents <page-id>
```

**Optional range:**

| Option | Description |
|--------|-------------|
| `--from <number>` | Start from this 1-based line (inclusive). |
| `--lines <number>` | Maximum number of lines to print. |

Examples:

```bash
# First 30 lines only
bun run scripts/tools/notion/notion.ts contents <page-id> --lines 30

# From line 50 to the end
bun run scripts/tools/notion/notion.ts contents <page-id> --from 50

# Lines 50–70 (from line 50, take 21 lines)
bun run scripts/tools/notion/notion.ts contents <page-id> --from 50 --lines 21
```

When `--from` and/or `--lines` are used, the CLI stops fetching more block pages once it has enough lines, so long pages are faster when you only need a slice.
