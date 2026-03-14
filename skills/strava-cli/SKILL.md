---
name: strava-cli
description: Run and use the Strava CLI in hub/strava to authenticate, refresh tokens, list activities, and fetch activity details. Use when the user wants Strava data, activities, or OAuth/auth for Strava.
requires:
  - env:STRAVA_CLIENT_ID
  - env:STRAVA_CLIENT_SECRET
  - env:STRAVA_STORAGE_PATH
---

# Hub Strava CLI

CLI in `hub/strava` for the Strava API. Run from the **project root** with `bun`.

## When to use this skill

Use this skill when the user:

- Asks about **recent workouts or activities** (runs, rides, etc.) from Strava.
- Wants **details for a specific activity**, such as distance, duration, pace, or heart rate.
- Needs help with **Strava authentication**, access tokens, or refreshing tokens.

Do **not** use this skill when:

- The user is asking about generic fitness concepts without needing their Strava data.
- The user does not have Strava or has not connected Strava yet (explain that Strava access is required).

Always respond with a **short, human summary** of the results instead of raw JSON, unless the user explicitly asks for raw data.

## Requirements

- **STRAVA_ACCESS_TOKEN** for most commands (get via `auth` first).
- **auth** and **refresh** need **STRAVA_CLIENT_ID**, **STRAVA_CLIENT_SECRET**, and **STRAVA_STORAGE_PATH** (file path where tokens are stored).

If any of these are missing:

- Tell the user **which variable is missing**.
- Show the **exact command(s)** they should run or the file they should configure.
- Do not keep retrying the same failing command.

## How to run

From repo root:

```bash
greg hub strava -- <command> [options] [args]
```

When you run any Strava CLI command, briefly tell the user:

- Which command you are running.
- The **time window or activity** you are targeting (if applicable).

## Commands

### auth

OAuth flow: opens browser for Strava authorization, then saves tokens to `STRAVA_STORAGE_PATH`. Requires `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_STORAGE_PATH`.

```bash
greg hub strava -- auth
greg hub strava -- auth --code <authorization-code>
greg hub strava -- auth --redirect-port 8080
```

| Option                     | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `--code <code>`            | Authorization code from redirect (skips opening browser) |
| `--redirect-port <number>` | Port for OAuth callback (default 8080)                   |

### refresh

Refresh access token using the refresh token stored at `STRAVA_STORAGE_PATH`. Requires client ID/secret and existing tokens file.

```bash
greg hub strava -- refresh
```

### activities

Fetch latest activities. Default output is a table; use `--json` for raw JSON.

```bash
greg hub strava -- activities
greg hub strava -- activities -n 50 -p 2
greg hub strava -- activities --after <unix> --before <unix>
greg hub strava -- activities --json
```

| Option                    | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `-n, --per-page <number>` | Activities per page 1–200 (default 30)           |
| `-p, --page <number>`     | Page number for pagination                       |
| `--before <unix>`         | Unix timestamp: only activities before this time |
| `--after <unix>`          | Unix timestamp: only activities after this time  |
| `--json`                  | Output raw JSON instead of table                 |

**Typical flows:**

- **"Summarize my last week of runs"**
  1. Compute the Unix timestamps for the last 7 days.
  2. Run `activities --after <unix_7_days_ago> --before <unix_now>`.
  3. Filter to running activities.
  4. Return a short summary with:
     - Total distance
     - Total time
     - Number of runs
     - Average pace (if available)

- **"What did my last workout look like?"**
  1. Run `activities -n 1 --json`.
  2. Take the most recent activity and summarize:
     - Name, type, distance, duration
     - Pace/speed and average heart rate (if available).
  3. Only mention metrics that exist in the response.

### activity \<id\>

Fetch a single activity by ID with full details. Outputs JSON.

```bash
greg hub strava -- activity <id>
```

When a user references “that run” or “my marathon” instead of an ID:

1. Use `activities` with an appropriate date filter or page size to find likely candidates (by **name and date**).
2. Show the user the top 3–5 matching activities with:
   - ID
   - Name
   - Date
   - Distance
3. Ask them which ID to inspect, or pick the most obvious match and say what you chose.

Once you have an ID, run `activity <id>`, then:

- Summarize the key stats in a short bullet list.
- Avoid dumping the full JSON unless the user explicitly asks for raw API output.

## Notes

- Set **STRAVA_ACCESS_TOKEN** from the token printed after `auth` (or from the file at `STRAVA_STORAGE_PATH`) before running `activities` or `activity`.
- Strava app callback URL must be set to `http://localhost:8080` (or the chosen `--redirect-port`) for the OAuth flow.
