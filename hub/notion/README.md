# Notion

CLI for the Notion API: search pages, get page JSON, export page contents as Markdown.

Requires **NOTION_API_KEY** (from [Notion integrations](https://www.notion.so/profile/integrations/internal)). Share pages with your integration to query them.

```bash
notion doctor # ensures env vars are OK
notion search --query "meeting notes" --page-only
notion get <page-id>
notion contents <page-id> [--from <line>] [--lines <n>]
```
