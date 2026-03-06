---
name: discover-models
description: "Discover available LLM models, compare to what Greg is currently running, and optionally switch to a newer model with user confirmation at each step."
---

## Overview

Use this skill when the user wants to know what models are available, what Greg is currently running, or wants to switch to a newer model.

`[CODE_PATH]` refers to the code directory. Check the environment if unsure.

## Steps 1–3: Gather data silently

Run these steps without announcing them. Collect the data, then jump straight to the summary.

**1. Check current config**
Read `[CODE_PATH]/.greg.ts` — note primary, fallback, and any other configured models.

**2. Check locally installed models**
```bash
grep -oE 'id: "(claude|gpt|o1|o3|o4)[^"]*"' [CODE_PATH]/node_modules/@mariozechner/pi-ai/dist/models.generated.js | sort -u
```

**3. Check GitHub for latest models**
```bash
curl -s "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/models.generated.ts" | grep -oE 'id: "(claude|gpt|o1|o3|o4)[^"]*"' | sort -u
```

## Step 4: Report summary to user

Give a concise summary:
- Mention that model discovery is based on the `@mariozechner/pi-ai` (pi-mono) package, and that newer models listed on GitHub may not yet be fully supported by the package
- What they're currently running (primary + fallback)
- Any new models on GitHub not in the local file
- Whether action is needed or everything is up to date

No need to list all models — just the relevant highlights.

## Step 5: If user explicitly wants to switch

Go step by step, **announcing each step and asking for permission before proceeding**.

### 5a. Check current package version
- Read `[CODE_PATH]/package.json` to find the current `@mariozechner/pi-ai` version
- Tell the user the current version and that you'll update it to latest
- Ask: "Shall I proceed?"

### 5b. Update the package
- Run: `cd [CODE_PATH] && bun install @mariozechner/pi-ai@latest`
- Report the result and the new version installed
- Ask: "Shall I update `.greg.ts` next?"

### 5c. Update `.greg.ts`
- Update the model in `[CODE_PATH]/.greg.ts` to the new model the user wants (use `getModel('anthropic', 'new-model-id')` or the appropriate provider)
- Show the user the exact change you're making
- Ask: "Shall I validate the config?"

### 5d. Validate the config
- Run: `greg config validate`
- Report the result
- If errors: show them and stop — do not restart
- If clean: ask: "Config looks good. Shall I restart?"

### 5e. Restart
- Save a conversation note summarizing the switch
- Tell the user: "I'm about to restart to apply the new model."
- Run: `greg restart`
