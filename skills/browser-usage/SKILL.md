---
name: browser-usage
description: 'Instructions for using the `run_browser_task` tool'
---

## Summary

- `run_browser_task` allows you to send a task to a browser agent.
- One clear action per `run_browser_task` call.
- Give the user a short update after each step when it makes sense.
- Use the next call to continue from where the previous one left off; the session is kept alive.

## Example: booking a flight

User prompt: "Book me a flight from AMS to NYC for tomorrow"

1. Update user: "Plan: I'm going to open klm.nl and will look for flights"
2. Run: `run_browser_task({task: 'Open klm.nl'})`
3. User update before: "Update: I've opened KLM.nl. I will now look for flights."
4. Run: `run_browser_task({task: 'Find flights between AMS and NYC for tomorrow'})`
5. User update before: "Done: I've found the following flights: ..."

## Example: checking opening hours

User prompt: "What are the opening hours of the Rijksmuseum in Amsterdam?"

1. Update user: "Plan: I'll open the Rijksmuseum website and find the opening hours."
2. Run: `run_browser_task({task: 'Open rijksmuseum.nl'})`
3. User update before: "Update: I've opened the Rijksmuseum site. Looking for the opening hours now."
4. Run: `run_browser_task({task: 'Find the opening hours'})`
5. User update before: "Done: The Rijksmuseum is open ..."

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
