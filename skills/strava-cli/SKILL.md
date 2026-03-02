---
name: strava-cli
description: Run and use the Strava CLI in hub/strava to authenticate, refresh tokens, list activities, and fetch activity details. Use when the user wants Strava data, activities, or OAuth/auth for Strava.
---

# Hub Strava CLI

CLI in `hub/strava` for the Strava API. Run from the **project root** with `bun`.

## Requirements

- **STRAVA_ACCESS_TOKEN** for most commands (get via `auth` first).
- **auth** and **refresh** need **STRAVA_CLIENT_ID**, **STRAVA_CLIENT_SECRET**, and **STRAVA_STORAGE_PATH** (file path where tokens are stored).

## How to run

From repo root:

```bash
bun run hub/strava -- <command> [options] [args]
```

## Commands

### auth

OAuth flow: opens browser for Strava authorization, then saves tokens to `STRAVA_STORAGE_PATH`. Requires `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_STORAGE_PATH`.

```bash
bun run hub/strava -- auth
bun run hub/strava -- auth --code <authorization-code>
bun run hub/strava -- auth --redirect-port 8080
```

| Option                     | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `--code <code>`            | Authorization code from redirect (skips opening browser) |
| `--redirect-port <number>` | Port for OAuth callback (default 8080)                   |

### refresh

Refresh access token using the refresh token stored at `STRAVA_STORAGE_PATH`. Requires client ID/secret and existing tokens file.

```bash
bun run hub/strava -- refresh
```

### activities

Fetch latest activities. Default output is a table; use `--json` for raw JSON.

```bash
bun run hub/strava -- activities
bun run hub/strava -- activities -n 50 -p 2
bun run hub/strava -- activities --after <unix> --before <unix>
bun run hub/strava -- activities --json
```

| Option                    | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `-n, --per-page <number>` | Activities per page 1–200 (default 30)           |
| `-p, --page <number>`     | Page number for pagination                       |
| `--before <unix>`         | Unix timestamp: only activities before this time |
| `--after <unix>`          | Unix timestamp: only activities after this time  |
| `--json`                  | Output raw JSON instead of table                 |

### activity \<id\>

Fetch a single activity by ID with full details. Outputs JSON.

```bash
bun run hub/strava -- activity <id>
```

## Notes

- Set **STRAVA_ACCESS_TOKEN** from the token printed after `auth` (or from the file at `STRAVA_STORAGE_PATH`) before running `activities` or `activity`.
- Strava app callback URL must be set to `http://localhost:8080` (or the chosen `--redirect-port`) for the OAuth flow.
