---
name: strava-cli
description: Run and use the Strava CLI to authenticate, refresh tokens, list activities, and fetch activity details. Use when the user wants Strava data, activities, or OAuth/auth for Strava.
requires:
  - env:STRAVA_CLIENT_ID
  - env:STRAVA_CLIENT_SECRET
---

# Strava CLI

CLI for the Strava API

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

- **auth** and **refresh** need **STRAVA_CLIENT_ID** and **STRAVA_CLIENT_SECRET**. Tokens are stored in a file; path defaults to **~/.strava-tokens.json** unless **STRAVA_STORAGE_PATH** is set.
- **activities** and **activity** read the access token from that tokens file (written by `strava auth` or `strava refresh`); you do not set `STRAVA_ACCESS_TOKEN` yourself.
- Run **`strava doctor`** to check env vars and whether auth is OK or needs refresh; use it when checking CLI health or troubleshooting.

### How to obtain the required env vars

1. **STRAVA_CLIENT_ID** and **STRAVA_CLIENT_SECRET**
   - Log in at [Strava](https://www.strava.com), go to [Settings → My API Application](https://www.strava.com/settings/api) (or create an app if you don’t have one).
   - Note your **Client ID** and **Client Secret**.
   - Under **Authorization Callback Domain**, set `localhost` (for local OAuth with default port 8080).

2. **STRAVA_STORAGE_PATH** (optional)
   - Tokens are stored in a file. Default is **~/.strava-tokens.json**. Set this env var only if you want a different path (e.g. a path in your project). The file is created when you run `strava auth`.

3. **Set the env vars** (e.g. in your shell or a `.env` file in the project root):
   - `STRAVA_CLIENT_ID=<your-client-id>`
   - `STRAVA_CLIENT_SECRET=<your-client-secret>`
   - Optionally: `STRAVA_STORAGE_PATH=/path/to/strava-tokens.json`

4. **Get an access token:** run `strava auth`. A browser will open for Strava authorization; after you approve, tokens are written to the storage file (default `~/.strava-tokens.json`). The CLI then uses that file for `activities` and `activity`; no need to set any other env var. Use `strava refresh` when the access token has expired.

If a required env var is missing:

- Tell the user **which variable is missing** and direct them to **How to obtain the required env vars** above.
- Do not keep retrying the same failing command.

## How to run

From **project root**:

```bash
strava <command> [options] [args]
```

Example: `strava activities -n 10`.

When you run any Strava CLI command, briefly tell the user:

- Which command you are running.
- The **time window or activity** you are targeting (if applicable).

## Commands

### doctor

Check env vars (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET) and auth: token file present, tokens valid, or need to run `strava auth` / `strava refresh`. Exit code 0 = OK, 1 = issue. Run this first when checking CLI health.

```bash
strava doctor
```

### auth

OAuth flow: opens browser for Strava authorization, then saves tokens to the storage file (default `~/.strava-tokens.json`, or `STRAVA_STORAGE_PATH` if set). Requires `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.

```bash
strava auth
strava auth --code <authorization-code>
strava auth --redirect-port 8080
```

| Option                     | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `--code <code>`            | Authorization code from redirect (skips opening browser) |
| `--redirect-port <number>` | Port for OAuth callback (default 8080)                   |

### refresh

Refresh access token using the refresh token in the storage file (default `~/.strava-tokens.json`). Requires client ID/secret and an existing tokens file from `strava auth`.

```bash
strava refresh
```

### activities

Fetch latest activities. Default output is a table; use `--json` for raw JSON.

```bash
strava activities
strava activities -n 50 -p 2
strava activities --after <unix> --before <unix>
strava activities --json
```

| Option                    | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `-n, --per-page <number>` | Activities per page 1–200 (default 30)           |
| `-p, --page <number>`     | Page number for pagination (default 1)           |
| `--before <unix>`         | Unix timestamp: only activities before this time |
| `--after <unix>`          | Unix timestamp: only activities after this time  |
| `--json`                  | Output raw JSON instead of table                 |

**Typical flows:**

- **"Summarize my last week of runs"**
  1. Compute the Unix timestamps for the last 7 days.
  2. Run `strava activities --after <unix_7_days_ago> --before <unix_now>`.
  3. Filter to running activities.
  4. Return a short summary with:
     - Total distance
     - Total time
     - Number of runs
     - Average pace (if available)

- **"What did my last workout look like?"**
  1. Run `strava activities -n 1 --json`.
  2. Take the most recent activity and summarize:
     - Name, type, distance, duration
     - Pace/speed and average heart rate (if available).
  3. Only mention metrics that exist in the response.

### activity \<id\>

Fetch a single activity by ID with full details. Outputs JSON.

```bash
strava activity <id>
```

When a user references “that run” or “my marathon” instead of an ID:

1. Use `strava activities` with an appropriate date filter or page size to find likely candidates (by **name and date**).
2. Show the user the top 3–5 matching activities with:
   - ID
   - Name
   - Date
   - Distance
3. Ask them which ID to inspect, or pick the most obvious match and say what you chose.

Once you have an ID, run `strava activity <id>`, then:

- Summarize the key stats in a short bullet list.
- Avoid dumping the full JSON unless the user explicitly asks for raw API output.

## Notes

- **activities** and **activity** read the access token from the tokens file (default `~/.strava-tokens.json`, written by `strava auth` or `strava refresh`).
- Strava app **Authorization Callback Domain** must include `localhost`; the OAuth redirect URL is `http://localhost:8080` (or the chosen `--redirect-port`).
