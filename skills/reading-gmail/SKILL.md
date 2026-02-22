---
name: reading-gmail
description: "How to read user's emails across the 3 main Gmail tabs"
---

## Reading User's Emails

When the user asks me to "read my emails", I should read emails from all 3 main Gmail tabs:

### Process:

1. **Primary tab** - Click and read important personal/work emails
2. **Promotions tab** - Click and read marketing/promotional emails
3. **Updates tab** - Click and read notifications and updates

### Method:

- Open main.google.com
- Use `snapshot_web_page` to get the element IDs
- Use `click_on_web_page_element` with the tab IDs to switch between tabs
- Use `read_web_page` or `screenshot_web_page` to see the emails in each tab
- Provide a summary of what's in each category

This gives the user a complete overview of their inbox across all main categories.
