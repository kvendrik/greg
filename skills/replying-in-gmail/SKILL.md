---
name: replying-in-gmail
description: "How to help user reply to emails in Gmail by navigating the interface and drafting responses"
---

## Replying to Emails in Gmail

### Process for Helping User Reply to Emails:

Use `bun run browser-use` with a task description that includes all the necessary steps:

```bash
bun run browser-use "Navigate to https://mail.google.com, find the email from [sender_email] with subject '[subject]' (or the most recent email from [sender_email]), open it, and draft a reply saying: '[reply_content]'. Do not send the email, just draft it."
```

### Task Description Guidelines:

1. **Specify the email to reply to:**
   - Include sender email address if known
   - Include subject line if known
   - Or specify "most recent email from [sender]"
   - Mention which tab to check (Primary, Promotions, or Updates)

2. **Include the reply content:**
   - Provide the full text of the reply
   - Follow user preferences for tone, language, and formatting
   - Be clear and specific about what to write

3. **Important instructions:**
   - Always specify "Do not send the email, just draft it"
   - The agent will draft the reply but leave it for user approval

4. **After browser-use completes:**
   - Review the drafted message with the user
   - Ask if they want any changes before sending
   - Explain next steps (they can send it or request modifications)

### User Preferences for Email Replies:

- **Review before sending**: User likes to approve drafts before they go out
- **Professional but warm tone**: Especially for formal correspondence like medical/business
- **Dutch language**: For Dutch businesses/services
- **Acknowledge practical details**: Include relevant info like construction, scheduling considerations
- **Proper formatting**: Use clear structure with greeting, body, closing, and signature

### Technical Notes:

- The browser-use agent handles all navigation and interaction automatically
- Gmail interface uses dynamic IDs - the agent adapts to these automatically
- The agent will find the email, open it, and draft the reply autonomously
- If multiple Gmail accounts are open, specify which account to use in the task description
- The agent will leave the draft ready for review - it won't send automatically