---
name: reading-google-calendar
description: 'How to properly read and interpret Google Calendar'
---

# Reading Google Calendar Accurately

## MANDATORY PROCESS - FOLLOW EVERY STEP

**NEVER read calendar events without completing ALL steps below in order.**

### Step 1: USE READ_WEB_PAGE FIRST

1. **Open calendar.google.com**
2. **Use read_web_page** - This gives accurate text data that's easier to parse than visual interpretation
3. **Find today's date** - Look for "today" marker in the text output
4. **Note today's day name and date** - Write it down: "Today is [DAY] [DATE]"

### Step 2: READ COLUMN BY COLUMN FROM TEXT

**NEVER assume positions. ALWAYS match day names to dates from the text output.**

Go through each day systematically from the read_web_page output:

1. **MON [Date]**: [List events] - PAST/TODAY/FUTURE?
2. **TUE [Date]**: [List events] - PAST/TODAY/FUTURE?
3. **WED [Date]**: [List events] - PAST/TODAY/FUTURE?
4. **THU [Date]**: [List events] - PAST/TODAY/FUTURE?
5. **FRI [Date]**: [List events] - PAST/TODAY/FUTURE?
6. **SAT [Date]**: [List events] - PAST/TODAY/FUTURE?
7. **SUN [Date]**: [List events] - PAST/TODAY/FUTURE?

### Step 3: MANDATORY VERIFICATION CHECKLIST

Before reporting anything, answer these questions:

- [ ] What day is today? (Day name and date)
- [ ] Which events are PAST (before today)?
- [ ] Which events are TODAY?
- [ ] Which events are FUTURE (after today)?
- [ ] Have I matched EVERY event to the correct day column?

### Step 4: REPORT WITH TIMELINE MARKERS

**Format:** Always mark each event as _(past)_, _(today)_, or _(upcoming)_

**Example:**

- **Monday 17th** _(past)_: Gym 10:00-11:00
- **Tuesday 18th** _(past)_: Meeting 14:00-15:00
- **Today - Wednesday 19th**: Yoga 12:00-13:00
- **Thursday 20th** _(upcoming)_: Dinner 19:00-21:00

### Step 5: DIG DEEPER WHEN NEEDED

**ALWAYS click through to get full event details when:**

- Event titles are vague or intriguing
- You need to know who else is attending
- Location details matter
- There might be descriptions with key info

**Process:**

1. Use `snapshot_web_page` to get interactive element IDs
2. Click on the specific event element
3. Use `read_web_page` again to see the detailed event popup
4. Look for: descriptions, attendees, full location details, organizer info

## CRITICAL RULES

- **USE read_web_page as primary method** - More accurate than screenshot interpretation
- **Screenshot only for verification if text is unclear**
- **NEVER assume event timing without verification**
- **NEVER read dates left-to-right without checking day names**
- **NEVER report events as "coming up" without confirming they're after today**
- **ALWAYS identify today before reading any events**
- **ALWAYS click through for full details** - Calendar summaries often hide key information

## Common Error Prevention

- Events showing on calendar ≠ upcoming events
- Past events display on calendar just like future ones
- Weekend layouts can be confusing - always verify day names
- Today is marked as "today" in the text output - use this as your anchor point
- Text parsing is more reliable than visual interpretation of screenshots
- Event descriptions contain crucial details not visible in the grid view
- Attendee information is only visible in detailed event view

## Key Insights

- **Most important info is sometimes in the details** - "Goats goats goats 🐐" looked basic but contained "So excited to go with Petri" in the description
- **Click-through reveals the story** - Surface view shows what/when, detailed view shows who/why/context
