---
name: browser-usage
description: Use when you need to interact with a real browser (click, type, navigate, fill forms). Read this skill before using run_browser_task — the tool requires it.
---

## Summary

- `run_browser_task` allows you to send a task to a browser agent.
- One clear action per `run_browser_task` call.
- Give the user a short update after each step when it makes sense. Always put a newline after every update so updates are clearly separated.
- Use the next call to continue from where the previous one left off; the session is kept alive.

## When to use this skill

Use `run_browser_task` when:

- You need to interact with a **real browser** (click, type, navigate, submit forms, scroll, etc.).
- A page is heavily **JavaScript-driven** and `web_fetch` returns incomplete or empty content.
- The user explicitly asks you to **navigate a website, fill in a form, or compare live prices/availability**.

Do **not** use `run_browser_task` when:

- A simple `web_fetch` can retrieve the needed static content (articles, docs, simple listings).
- You only need to search the web for basic factual information that `web_search` or `web_fetch` can handle more cheaply and quickly.

## Try web_fetch first

Before reaching for `run_browser_task`, consider trying `web_fetch` first — it's much faster. It works well for server-rendered pages (articles, docs, public profiles, etc.). Fall back to `run_browser_task` if the content is missing or incomplete due to JS rendering, or if you need to interact with the page (click, fill forms, etc.).

When you decide to use `run_browser_task`:

- Tell the user **why**: for example, that `web_fetch` did not contain the needed content or interaction is required.
- Keep each browser task focused on **one concrete action**.

## Transparency about tool fallbacks

If a tool fails (e.g. `web_search` returns a 503, or `web_fetch` returns incomplete content) and you decide to switch to `run_browser_task`, tell the user before doing so. Explain briefly what failed and what you're doing instead. Don't silently switch tools.

If `run_browser_task` itself fails (navigation errors, timeouts, CAPTCHAs, paywalls):

- Explain clearly what went wrong.
- Try a small number of sensible retries (e.g. reload, try a different URL, or adjust the query).
- If it still fails, stop and tell the user what partial information you do have instead of looping endlessly.

## Example: booking a flight

User prompt: "Book me a flight from AMS to NYC for tomorrow"

(Each update below is followed by a newline before the next step.)

1. Update user: "Plan: I'm going to open klm.nl and will look for flights"
2. Run: `run_browser_task({task: 'Open klm.nl'})`
3. User update before: "Update: I've opened KLM.nl. I will now look for flights."
4. Run: `run_browser_task({task: 'Find flights between AMS and NYC for tomorrow'})`
5. User update before: "Done: I've found the following flights: ..."

When presenting results:

- Show each option with airline, departure/arrival time, duration, and price (if available).
- Ask the user which specific flight they want before attempting any booking-like action (and only proceed if booking via browser is actually supported).

## Example: checking opening hours

User prompt: "What are the opening hours of the Rijksmuseum in Amsterdam?"

1. Update user: "Plan: I'll open the Rijksmuseum website and find the opening hours."
2. Run: `run_browser_task({task: 'Open rijksmuseum.nl'})`
3. User update before: "Update: I've opened the Rijksmuseum site. Looking for the opening hours now."
4. Run: `run_browser_task({task: 'Find the opening hours'})`
5. User update before: "Done: The Rijksmuseum is open ..."

Be explicit about:

- Date or day-of-week context if relevant (e.g. holidays, weekend vs weekday).
- Any special notes (late openings, last entry time) that you see on the page.

## Example: comparing prices (more steps)

User prompt: "Is the Sony WH-1000XM5 cheaper on bol.com or on Amazon.nl?"

1. Update user: "Plan: I'll check the price on bol.com first, then on Amazon.nl, and compare."
2. Run: `run_browser_task({task: 'Open bol.com'})`
3. User update before: "Update: Opened bol.com. Searching for the headphone now."
4. Run: `run_browser_task({task: 'Search for Sony WH-1000XM5'})`
5. User update before: "Update: Found the product. Reading the price."
6. Run: `run_browser_task({task: 'Get the current price of the first Sony WH-1000XM5 result'})`
7. User update before: "Update: Noted bol.com price. Opening Amazon.nl next."
8. Run: `run_browser_task({task: 'Open amazon.nl'})`
9. User update before: "Update: On Amazon.nl. Searching for the same headphone."
10. Run: `run_browser_task({task: 'Search for Sony WH-1000XM5'})`
11. User update before: "Update: Checking the Amazon price."
12. Run: `run_browser_task({task: 'Get the current price of the first Sony WH-1000XM5 result'})`
13. User update before: "Done: On bol.com it's €X, on Amazon.nl it's €Y. The cheaper option is ..."

When comparing prices:

- Use the **same product variant** (same model, color, capacity) on each site when possible.
- Mention currency and whether the price includes shipping if that is easily visible.

## Example: finding events at a venue

User prompt: "Find me concerts at Paradiso this weekend"

1. Try `web_search` for "Paradiso Amsterdam concerts this weekend [dates]".
2. If `web_search` fails (e.g. 503): tell the user — "web_search failed, trying web_fetch instead."
3. Try `web_fetch` on the venue's website (e.g. `https://www.paradiso.nl`).
4. If `web_fetch` returns incomplete results (e.g. no weekend-specific events): tell the user — "The page didn't have the full agenda, switching to the browser."
5. Run: `run_browser_task({task: 'Go to paradiso.nl and find all events on [dates]. List each event with name, date, time, and venue.'})`
6. Present results to the user grouped by day.

For all browser tasks:

- Keep prompts **specific and actionable** (“Click X”, “Search for Y”, “Extract Z fields from the current page”).
- Avoid unnecessary navigation steps to minimize latency and token usage.
