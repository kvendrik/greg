# Strava

CLI for the Strava API: OAuth, list activities, fetch activity details.

Set **STRAVA_CLIENT_ID** and **STRAVA_CLIENT_SECRET** (from [Strava API settings](https://www.strava.com/settings/api)), then run `strava auth` once. Tokens are stored in `~/.strava-tokens.json` (override with **STRAVA_STORAGE_PATH**).

```bash
strava auth
strava doctor # ensures env vars and auth are OK
strava refresh
strava activities [-n 30] [--after <unix>] [--before <unix>]
strava activity <id>
```
