---
name: reading-google-calendar
description: 'How to properly read and interpret Google Calendar'
---

# Reading Google Calendar Accurately

## MANDATORY PROCESS - FOLLOW EVERY STEP

**NEVER read calendar events without completing ALL steps below in order.**

### Step 1: USE BROWSER-USE TO READ CALENDAR

Use `bun run browser-use` with a detailed task description:

```bash
bun run browser-use "Navigate to https://calendar.google.com and read all calendar events for the current week. Identify today's date clearly. For each event, extract: day name, date, time, title, and determine if it's past, today, or upcoming. Click through to get full details (description, attendees, location, organizer) for any events with vague titles or when those details are needed. Organize the output by day with clear markers for past/today/upcoming events."
```

### Step 2: VERIFY THE OUTPUT

**NEVER assume positions. ALWAYS verify dates and timing.**

After browser-use completes, verify:

1. **What day is today?** - Confirm the day name and date from the output
2. **Match events to correct days** - Verify each event is assigned to the correct date
3. **Categorize correctly** - Ensure events are marked as past/today/upcoming correctly

### Step 3: MANDATORY VERIFICATION CHECKLIST

Before reporting anything, answer these questions:

- [ ] What day is today? (Day name and date)
- [ ] Which events are PAST (before today)?
- [ ] Which events are TODAY?
- [ ] Which events are FUTURE (after today)?
- [ ] Have I matched EVERY event to the correct day column?
- [ ] Have I clicked through for full details when needed?

### Step 4: REPORT WITH TIMELINE MARKERS

**Format:** Always mark each event as _(past)_, _(today)_, or _(upcoming)_

**Example:**

- **Monday 17th** _(past)_: Gym 10:00-11:00
- **Tuesday 18th** _(past)_: Meeting 14:00-15:00
- **Today - Wednesday 19th**: Yoga 12:00-13:00
- **Thursday 20th** _(upcoming)_: Dinner 19:00-21:00

### Step 5: REQUEST DETAILS WHEN NEEDED

**ALWAYS request full event details when:**

- Event titles are vague or intriguing
- You need to know who else is attending
- Location details matter
- There might be descriptions with key info

**Include in task description:**
- "Click through to get full details (description, attendees, location, organizer) for any events with vague titles"
- Or specify: "Get full details for event '[event title]'"

## CRITICAL RULES

- **USE browser-use with detailed task description** - The agent will handle navigation and extraction
- **ALWAYS request identification of today's date** - Include this in the task description
- **NEVER assume event timing without verification** - Verify dates and times from the output
- **NEVER read dates left-to-right without checking day names** - Verify day names match dates
- **NEVER report events as "coming up" without confirming they're after today** - Verify timing
- **ALWAYS identify today before reading any events** - Include this requirement in the task
- **ALWAYS request full details when needed** - Include click-through instructions in task description

## Common Error Prevention

- Events showing on calendar ≠ upcoming events
- Past events display on calendar just like future ones
- Weekend layouts can be confusing - always verify day names
- Today should be clearly identified - include this requirement in the task description
- Request text extraction rather than relying on screenshots
- Event descriptions contain crucial details not visible in the grid view - request click-through
- Attendee information is only visible in detailed event view - request full details when needed

## Key Insights

- **Most important info is sometimes in the details** - "Goats goats goats 🐐" looked basic but contained "So excited to go with Petri" in the description
- **Click-through reveals the story** - Surface view shows what/when, detailed view shows who/why/context
- **Include click-through instructions** - Always request full event details in the task description when details matter
