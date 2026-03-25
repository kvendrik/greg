---
name: web-fetch-readability
description: "When to use use_readability false vs true on web_fetch, based on page type."
---

## web_fetch readability parameter

- **Default (readability: true)**: Use for articles, docs, blogs — server-rendered pages where the main content is in the HTML. Strips noise like nav and footers.
- **readability: false**: Use for JS-heavy or app-like pages (e.g. SPAs, retro UIs, custom layouts) where readability returns almost nothing useful. Gets noisier output but captures more actual content.

### Example
kvendrik.com uses a retro Windows 95-style JS UI. With readability on, web_fetch only returns link labels. With readability off, it returns the full bio content from the HTML.

### Rule of thumb
If web_fetch returns suspiciously little (just nav labels, link text, or a few words), retry with `use_readability: false`.
