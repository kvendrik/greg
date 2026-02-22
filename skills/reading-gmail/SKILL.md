---
name: reading-gmail
description: "How to read user's emails across the 3 main Gmail tabs"
---

## Reading User's Emails

When the user asks me to "read my emails", I should read emails from all 3 main Gmail tabs:

### Process:

Use `bun run browser-use` to read emails from all main Gmail tabs:

```bash
bun run browser-use "Navigate to https://mail.google.com and read all emails from the Primary, Promotions, and Updates tabs. For each tab, list the sender, subject, and a brief summary of each email. Provide a complete overview organized by tab."
```

### Task Description Guidelines:

1. **Specify all tabs to read:**
   - Primary tab (important personal/work emails)
   - Promotions tab (marketing/promotional emails)
   - Updates tab (notifications and updates)

2. **Request structured output:**
   - Ask for sender, subject, and brief summary for each email
   - Request organization by tab/category
   - Ask for a complete overview

3. **Alternative: Read specific tabs only:**
   ```bash
   bun run browser-use "Navigate to https://mail.google.com and read emails from the Primary tab. List sender, subject, and brief summary for each email."
   ```

### After browser-use completes:

- Review the output from the agent
- Present a clear summary organized by tab
- Highlight any important or urgent emails
- This gives the user a complete overview of their inbox across all main categories
