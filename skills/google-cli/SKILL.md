---
name: google-cli
description: 'Use the gog CLI (gogcli) to read calendar events, Gmail emails, and Google Tasks, and to create Gmail drafts. Use when the user wants Google Calendar, Gmail, or Google Tasks data, or to compose or draft emails.'
requires:
  - gog
  - env:GOG_ACCOUNT
---

# Google CLI (gog)

Before doing anything else make sure `gog` is available by running `which gog`. If it's not refer to the Github page: https://github.com/steipete/gogcli.

Use the **gog** CLI from [gogcli](https://github.com/steipete/gogcli) for Gmail, Calendar, and Tasks. Install with `brew install steipete/tap/gogcli`. The user must have run `gog auth credentials <path>` and `gog auth add <email>` at least once.

- **Account**: `--account <email>` or `GOG_ACCOUNT`. Use `--json` for script/LLM-friendly output.
- **Help**: `gog --help`, `gog calendar --help`, `gog gmail --help`, `gog tasks --help`.

## When to use this skill

Use this skill when the user:

- Wants to **read or manage Google Calendar events** (today, tomorrow, this week, a specific range).
- Wants to **read or manage Gmail emails** (search, summarize, inspect threads/messages, create or update drafts).
- Wants to **read Google Tasks** (task lists and tasks).

Do **not** use this skill when:

- The user is asking about Google services in general (settings, quotas, product comparisons) without needing their own data.
- Authentication is not set up yet; first explain the setup steps.

Always prefer `--json` output, then parse and return a **clear human summary** instead of dumping raw JSON, unless the user explicitly asks for it.

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

**Typical flows (Calendar):**

- **"What’s on my calendar today/tomorrow/this week?"**
  1. Use `events primary --today/--tomorrow/--week --json`.
  2. Summarize as a list of events with:
     - Start time (with timezone if ambiguous)
     - Title
     - Location (if present)
  3. If there are many events, highlight the most important ones based on titles and time.

- **"Find meetings with X in the next 30 days"**
  1. Use `calendar search "X" --days 30 --max 50 --json`.
  2. Return a concise table (time, title, calendar).

## 2. Create calendar events

```bash
gog calendar create primary --summary "Event title" --from "2026-03-04T10:00:00+01:00" --to "2026-03-04T11:00:00+01:00" --json

# With description and location
gog calendar create primary --summary "Meeting" --from "2026-03-04T10:00:00+01:00" --to "2026-03-04T11:00:00+01:00" --description "Catch-up" --location "Amsterdam" --json

# All-day event
gog calendar create primary --summary "Holiday" --from "2026-03-10" --to "2026-03-11" --all-day --json

# With attendees and Google Meet
gog calendar create primary --summary "Call" --from "2026-03-04T10:00:00+01:00" --to "2026-03-04T11:00:00+01:00" --attendees "someone@example.com" --with-meet --json

# With reminder
gog calendar create primary --summary "Dentist" --from "2026-03-05T09:00:00+01:00" --to "2026-03-05T10:00:00+01:00" --reminder "popup:30m" --json

# Recurring event
gog calendar create primary --summary "Weekly sync" --from "2026-03-04T10:00:00+01:00" --to "2026-03-04T11:00:00+01:00" --rrule "RRULE:FREQ=WEEKLY" --json
```

Key flags:

- `--summary` — event title
- `--from` / `--to` — RFC3339 datetime or date-only for all-day
- `--description` — event description
- `--location` — location string
- `--attendees` — comma-separated emails
- `--all-day` — all-day event
- `--with-meet` — add Google Meet link
- `--reminder` — e.g. `popup:30m`, `email:1d`
- `--rrule` — recurrence rule
- `--send-updates` — `all`, `externalOnly`, `none` (default: none)

**Safety:**

- Always repeat back the **event details** (summary, date/time, attendees) before creating.
- For events with external attendees or `--send-updates`, explicitly tell the user that invitations/updates may be emailed.
- Do not create or modify events without clear user confirmation.

## 3. Update and delete calendar events

```bash
# Update an event
gog calendar update primary <eventId> --summary "New title" --from "2026-03-04T11:00:00+01:00" --to "2026-03-04T12:00:00+01:00" --json

# Delete an event
gog calendar delete primary <eventId> --json
```

For updates and deletions:

- First fetch the event and **show a short summary** (title, time) so the user can confirm it’s the right one.
- Ask explicitly before deleting or significantly changing time/attendees.
- After success, confirm what changed or that the event was deleted.

## 4. Read Gmail emails

Search by query, then fetch thread or message. Use Gmail search syntax (e.g. `newer_than:7d`, `from:user@example.com`, `is:unread`, `has:attachment`).

```bash
# Thread-level search (default table; use --json for JSON)
gog gmail search 'newer_than:7d' --max 20 --json

# Message-level search (one row per email)
gog gmail messages search 'newer_than:7d' --max 20 --json

# Get one thread (messages in thread)
gog gmail thread get <threadId> --json

# Get one message
gog gmail get <messageId> --json
gog gmail get <messageId> --format metadata --json
```

**Typical flows (Gmail):**

- **"Summarize my important emails from the last week"**
  1. Use `messages search 'newer_than:7d' --max 20 --json` with an appropriate filter (`label:IMPORTANT` if desired).
  2. Summarize each email as:
     - From, subject, date
     - 1–2 sentence summary of the body.
  3. Present as a numbered list, highlighting actions or deadlines if visible.

- **"Show me the full thread for this email"**
  1. Use `gmail thread get <threadId> --json`.
  2. Present messages in chronological order with sender, timestamp, and short body excerpts.

## 5. Write Gmail drafts

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

**Safety & confirmation:**

- Use drafts for composing; **never send** an email without explicit user confirmation.
- Before calling `drafts send`, repeat back:
  - Recipients
  - Subject
  - A short preview of the body
- If the user only asked to “write” or “draft” an email, **stop after creating/updating the draft** and tell them how to send it themselves.

## 6. Read Google Tasks

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

If `gog` is missing, credentials are not configured, or scopes are insufficient:

- Explain the problem in plain language.
- Point the user to the `gog` GitHub page and the required `gog auth` commands.
- Do not keep retrying failing `gog` commands.
