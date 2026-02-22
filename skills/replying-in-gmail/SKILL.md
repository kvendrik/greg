---
name: replying-in-gmail
description: "How to help user reply to emails in Gmail by navigating the interface and drafting responses"
---

## Replying to Emails in Gmail

### Process for Helping User Reply to Emails:

1. **Open Gmail** 
   - Navigate to https://mail.google.com
   - Use `snapshot_web_page` to get current element IDs

2. **Find the Email**
   - Look in Primary tab first (most personal emails)
   - Can also check Promotions and Updates tabs if needed
   - Click on the email subject line to open it

3. **Open the Email**
   - Use `click_on_web_page_element` with the email's ID
   - Use `read_web_page` to see the full email content
   - Review the email details to understand what needs to be replied to

4. **Access Reply Compose Area**
   - Take a fresh `snapshot_web_page` after opening the email to get reply compose IDs
   - Reply compose area usually appears automatically when viewing an email
   - If not visible, look for and click a "Reply" button to open it

5. **Draft the Reply**
   - Use `type_into_web_page_element` with the message body text area ID
   - Draft an appropriate response based on the email content
   - Follow user preferences for tone, language, and formatting

6. **Present for Approval**
   - Show the drafted message to the user
   - Ask if they want any changes before sending
   - Explain next steps (they can send it or request modifications)

### User Preferences for Email Replies:

- **Review before sending**: User likes to approve drafts before they go out
- **Professional but warm tone**: Especially for formal correspondence like medical/business
- **Dutch language**: For Dutch businesses/services
- **Acknowledge practical details**: Include relevant info like construction, scheduling considerations
- **Proper formatting**: Use clear structure with greeting, body, closing, and signature

### Technical Notes:

- Gmail interface uses dynamic IDs that change between sessions
- Always take fresh snapshots to get current element IDs after each navigation step
- Look for text areas with labels like "Message Body" for typing replies
- If compose area doesn't appear automatically, manually click Reply button
- Check which Gmail account/tab is active if user has multiple accounts