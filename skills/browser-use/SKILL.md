---
name: browser-use
description: "How to use browser-use for autonomous browser automation tasks. Replaces the previous browser tool."
---

# Browser-Use for Autonomous Browser Automation

## Overview

`bun run browser-use` runs an autonomous AI agent that performs complex browser tasks. It uses the `browser_use` Python library's `Agent` class to execute tasks autonomously. This replaces the previous browser tool and should be used when you need an AI agent to navigate websites, interact with pages, fill forms, or extract information autonomously.

## When to Use Browser-Use

Use `bun run browser-use` when:

- **Autonomous browser tasks** - Tasks that require an AI agent to navigate, make decisions, and complete workflows independently
- **Complex multi-step workflows** - Tasks involving multiple pages, form submissions, or sequential interactions
- **Dynamic web interactions** - Sites with complex JavaScript, dynamic content, or that require understanding page context
- **Tasks requiring AI reasoning** - When the task needs understanding of page content, making choices, or adapting to different page layouts
- **Automated form filling** - Complex forms that require understanding context and relationships between fields
- **Web scraping with interaction** - When you need to interact with the page (click, scroll, wait) before extracting data

**Do NOT use browser-use for:**
- Simple one-step tasks that can be done with `curl` or direct API calls
- Tasks that don't require browser interaction
- Reading static content that can be fetched directly
- Tasks requiring fine-grained control over individual browser actions (use browser-use CLI instead)

## How to Use

### Command Format

```bash
bun run browser-use "<task_description>"
```

The task description should be a clear, natural language prompt describing what you want the agent to accomplish in the browser. The agent will autonomously plan and execute the necessary steps.

### Examples

**Example 1: Complex Navigation Task**
```bash
bun run browser-use "Navigate to Gmail, find the most recent email from john@example.com, and draft a reply saying I'll get back to them tomorrow"
```

**Example 2: Form Submission**
```bash
bun run browser-use "Go to example.com/contact, fill out the contact form with the user's name and message, and submit it"
```

**Example 3: Data Extraction with Interaction**
```bash
bun run browser-use "Visit example.com/products, scroll through the product listings, and extract all product names and prices"
```

**Example 4: Multi-Step Workflow**
```bash
bun run browser-use "Log into the admin panel at admin.example.com, navigate to the users section, find user with email test@example.com, and change their role to 'editor'"
```

## How It Works

The `browser-use.py` script:

1. **Takes a task prompt** - Receives a natural language description of what to accomplish
2. **Launches browser** - Starts a `Browser()` instance (real browser, visible by default)
3. **Creates AI agent** - Initializes an `Agent` with:
   - The task prompt
   - Claude Sonnet 4.6 as the LLM
   - The browser instance
4. **Runs autonomously** - The agent plans steps, executes browser actions (clicks, typing, navigation), and adapts to page content
5. **Completes or errors** - Works until the task is complete or encounters an error

The agent handles all browser interactions internally - you don't need to specify individual actions.

## Technical Details

- **Runtime**: Python script executed via `uv run --env-file .env --script browser-use.py`
- **Library**: Uses `browser_use` Python library (version >=0.11.9)
- **LLM**: Claude Sonnet 4.6 (`claude-sonnet-4-6`) via Anthropic API
- **Browser**: Launches a real browser instance (visible by default, not headless)
- **Environment**: Requires `.env` file with `ANTHROPIC_API_KEY` set
- **Package Manager**: Uses `uv` for Python dependency management

## Best Practices

1. **Be specific and clear** - Provide detailed task descriptions with all necessary context
2. **Include URLs** - Always specify the website or page to visit
3. **Mention constraints** - Include any requirements, account details, or limitations
4. **One task per invocation** - Each call handles one complete task from start to finish
5. **Monitor execution** - The browser window is visible so you can watch the agent work
6. **Handle errors** - If the task fails, review the error output and refine your prompt

## Integration with Other Tools

- **Use with terminal tool** - Call `bun run browser-use` through the terminal command tool
- **Combine with memory** - Store results or context from browser-use in memory for future reference
- **Chain with skills** - Browser-use can be part of a larger workflow using other skills
- **Replace browser tool** - This replaces the previous browser tool that required manual step-by-step commands

## Important Notes

- **Autonomous execution** - The agent runs completely autonomously once started - you don't control individual actions
- **Browser visibility** - The browser window is visible by default so you can monitor progress
- **Single task focus** - Each invocation completes one full task - the browser closes when done
- **Error handling** - If the agent encounters an error, it will stop and report the issue
- **API key required** - Make sure your `.env` file has `ANTHROPIC_API_KEY` configured
- **Python dependencies** - Managed via `uv` and `pyproject.toml` (requires `browser-use>=0.11.9`)

## Difference from Browser-Use CLI

This implementation uses the **autonomous Agent API** from the `browser_use` library, which is different from the `browser-use` CLI tool. The CLI provides fine-grained control with commands like `browser-use open`, `browser-use click`, etc. This script runs a full autonomous agent that takes a task and completes it without manual intervention.
