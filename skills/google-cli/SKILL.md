---
name: google-cli
description: Use the gog CLI (gogcli) to read calendar events, Gmail emails, and Google Tasks, and to create Gmail drafts. Use when the user wants Google Calendar, Gmail, or Google Tasks data, or to compose or draft emails.
---

# Google CLI (gog)

Before doing anything else make sure `gog` is available by running `which gog`. If it's not refer to the Github page: https://github.com/steipete/gogcli.

Use the **gog** CLI from [gogcli](https://github.com/steipete/gogcli) for Gmail, Calendar, and Tasks. Install with `brew install steipete/tap/gogcli`. The user must have run `gog auth credentials <path>` and `gog auth add <email>` at least once.

- **Account**: `--account <email>` or `GOG_ACCOUNT`. Use `--json` for script/LLM-friendly output.
- **Help**: `gog --help`, `gog calendar --help`, `gog gmail --help`, `gog tasks --help`.

## 1. Read calendar events

List calendars, then list or get events.

```bash
# List calendars (get calendar IDs, e.g. primary)
gog calendar calendars --json

# Events for a calendar (use calendar ID, often "primary")
gog calendar events primary --today --json
gog calendar events primary --tomorrow --json
gog calendar events primary --week --json
gog calendar events primary --days 7 --json
gog calendar events primary --from today --to friday --json
gog calendar events --all --today --json
```

Single event:

```bash
gog calendar event <calendarId> <eventId> --json
# or
gog calendar get <calendarId> <eventId> --json
```

Search by text:

```bash
gog calendar search "meeting" --today --json
gog calendar search "meeting" --days 30 --max 50 --json
```

## 2. Read Gmail emails

Search by query, then fetch thread or message. Use Gmail search syntax (e.g. `newer_than:7d`, `from:user@example.com`, `is:unread`, `has:attachment`).

```bash
# Thread-level search (default table; use --json for JSON)
gog gmail search 'newer_than:7d' --max 20 --json

# Message-level search (one row per email)
gog gmail messages search 'newer_than:7d' --max 20 --json
# Include body text
gog gmail messages search 'newer_than:7d' --max 5 --include-body --json

# Get one thread (messages in thread)
gog gmail thread get <threadId> --json

# Get one message
gog gmail get <messageId> --json
gog gmail get <messageId> --format metadata --json
```

## 3. Write Gmail drafts

Create and update drafts. Optionally send a draft.

```bash
# Create draft (no recipient required)
gog gmail drafts create --subject "Subject" --body "Plain text body"
gog gmail drafts create --to recipient@example.com --subject "Subject" --body "Body"

# Create from file
gog gmail drafts create --subject "Subject" --body-file ./message.txt
gog gmail drafts create --subject "Subject" --body-file -   # stdin

# HTML body
gog gmail drafts create --to a@b.com --subject "Hi" --body "Plain fallback" --body-html "<p>Hello</p>"

# List drafts
gog gmail drafts list --json

# Update existing draft
gog gmail drafts update <draftId> --subject "New subject" --body "New body"
gog gmail drafts update <draftId> --to a@b.com --subject "Subject" --body "Body"

# Send a draft (optional)
gog gmail drafts send <draftId>
```

## 4. Read Google Tasks

List task lists, then list tasks or get one task.

```bash
# List task lists (get tasklistId values)
gog tasks lists --max 50 --json

# List tasks in a list
gog tasks list <tasklistId> --max 50 --json

# Get one task
gog tasks get <tasklistId> <taskId> --json
```

## Notes

- **Auth**: If multiple accounts exist, pass `--account <email>` or set `GOG_ACCOUNT`.
- **JSON**: Prefer `--json` (or `GOG_JSON=1`) when feeding output to the LLM or scripts.
- **Scopes**: User must have authorized with services that include `gmail`, `calendar`, and `tasks` (e.g. `gog auth add <email>` with default user services, or `--services gmail,calendar,tasks`).
