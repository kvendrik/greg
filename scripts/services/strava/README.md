# Strava CLI

CLI to authenticate with Strava (OAuth) and fetch your latest activities.

## Setup

1. **Create a Strava API application** at [strava.com/settings/api](https://www.strava.com/settings/api). Note your **Client ID** and **Client Secret**.

2. **Set the callback for local use:** In the same page, set **Authorization Callback Domain** to `localhost` (no port). The CLI uses `http://localhost:8080` as the redirect URI by default.

## Running the CLI

From the project root:

```bash
bun run scripts/tools/strava/strava.ts <command> [options]
```

## Commands

### `auth` — Get an access token

Obtains an access token using your client ID and secret. Use this before calling `activities`.

**With browser (interactive):**

Starts a local server, opens the Strava authorization page in your browser, and after you approve, exchanges the callback code for tokens.

```bash
export STRAVA_CLIENT_ID=your_client_id
export STRAVA_CLIENT_SECRET=your_client_secret
bun run scripts/tools/strava/strava.ts auth
```

Or pass credentials on the command line:

```bash
bun run scripts/tools/strava/strava.ts auth --client-id ID --client-secret SECRET
```

**With an existing authorization code:**

If you already have a `code` from the redirect URL (e.g. from another tool or manual copy):

```bash
bun run scripts/tools/strava/strava.ts auth --code "THE_CODE_FROM_REDIRECT"
```

**Options:**

- `--client-id <id>` — Application client ID (or `STRAVA_CLIENT_ID`)
- `--client-secret <secret>` — Application client secret (or `STRAVA_CLIENT_SECRET`)
- `--code <code>` — Authorization code; skips opening the browser
- `--redirect-port <number>` — Port for OAuth callback (default: 8080)
- `--json` — Print the full token response as JSON

**Output:** Prints `access_token` and `refresh_token`. Set `STRAVA_ACCESS_TOKEN` to the access token to use the `activities` command. Store the refresh token to use with `refresh` when the access token expires (after about 6 hours). If you are using Greg’s Strava integration, run `strava auth store --access-token <token> --refresh-token <token>` (via `greg services strava auth store --access-token <token> --refresh-token <token>`) to save these tokens to `STRAVA_STORAGE_PATH` for reuse.

### `refresh` — Get a new access token

Uses your refresh token to get a new access token without opening the browser.

```bash
bun run scripts/tools/strava/strava.ts refresh --refresh-token "YOUR_REFRESH_TOKEN"
```

Or set `STRAVA_REFRESH_TOKEN` and optionally pass client credentials via env or flags.

**Options:**

- `--client-id`, `--client-secret` — Same as `auth` (or use env)
- `--refresh-token <token>` — Refresh token from a previous `auth` (or `STRAVA_REFRESH_TOKEN`)
- `--json` — Print the token response as JSON

### `activities` — List your activities

Fetches your latest Strava activities. Requires `STRAVA_ACCESS_TOKEN` (from `auth` or `refresh`).

```bash
export STRAVA_ACCESS_TOKEN=your_access_token
bun run scripts/tools/strava/strava.ts activities
```

**Options:**

- `-n, --per-page <number>` — Number of activities per page (1–200, default: 30)
- `-p, --page <number>` — Page number (default: 1)
- `--before <unix>` — Only activities before this Unix timestamp
- `--after <unix>` — Only activities after this Unix timestamp
- `--json` — Output raw JSON instead of the table

**Example:** Last 10 activities as a table:

```bash
bun run scripts/tools/strava/strava.ts activities --per-page 10
```

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `STRAVA_CLIENT_ID` | `auth`, `refresh` | Strava application client ID |
| `STRAVA_CLIENT_SECRET` | `auth`, `refresh` | Strava application client secret |
| `STRAVA_ACCESS_TOKEN` | `activities` | Current access token (from `auth` or `refresh`) |
| `STRAVA_REFRESH_TOKEN` | `refresh` | Refresh token (from `auth`) |

You can use a `.env` file in the project root and load it before running (e.g. with `dotenv` or your shell) so you don’t have to export these every time.
