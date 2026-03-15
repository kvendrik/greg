import { spawnSync } from 'child_process';
import { createServer } from 'http';
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_OAUTH_BASE = 'https://www.strava.com/oauth';
const DEFAULT_REDIRECT_PORT = 8080;
const ACTIVITY_READ_SCOPE = 'activity:read_all';

type SummaryActivity = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain?: number;
  kudos_count?: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  athlete?: unknown;
};

const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.strava-tokens.json');

function getStoragePath(): string {
  const raw = process.env.STRAVA_STORAGE_PATH?.trim();
  if (!raw) return DEFAULT_STORAGE_PATH;
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function getTokens(): TokenResponse {
  const storagePath = getStoragePath();
  if (!fs.existsSync(storagePath)) {
    throw new Error(
      `Strava storage path (${storagePath}) does not exist. Run \`strava auth\` first.`
    );
  }
  const tokens = JSON.parse(
    fs.readFileSync(storagePath, 'utf8')
  ) as TokenResponse;
  if (!tokens.access_token) {
    throw new Error(
      'Strava access token not found in storage. Run `strava auth` first.'
    );
  }
  if (!tokens.refresh_token) {
    throw new Error(
      'Strava refresh token not found in storage. Run `strava auth` first.'
    );
  }
  if (tokens.expires_at < Date.now() / 1000) {
    throw new Error(
      'Strava access token has expired. Run `strava refresh` first.'
    );
  }
  return tokens;
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error(
      'STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are required (env or --client-id / --client-secret).'
    );
    process.exit(1);
  }
  return { clientId, clientSecret };
}

function openUrl(url: string): void {
  const platform = process.platform;
  const [cmd, ...args] =
    platform === 'darwin'
      ? ['open', url]
      : platform === 'win32'
        ? ['cmd', '/c', 'start', url]
        : ['xdg-open', url];
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  if (result.error) {
    console.error('Could not open browser. Visit this URL manually:\n', url);
  }
}

function listenForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '/';
      const parsed = new URL(url, `http://localhost:${port}`);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');

      const respond = (status: number, body: string) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(body);
      };

      if (error) {
        respond(400, `<p>Authorization failed: ${error}</p>`);
        server.close();
        reject(new Error(`Strava authorization failed: ${error}`));
        return;
      }

      if (code) {
        respond(
          200,
          '<p>Authorization successful. You can close this tab and return to the terminal.</p>'
        );
        server.close();
        resolve(code);
      } else {
        respond(400, '<p>Missing code in callback URL.</p>');
        server.close();
        reject(new Error('Missing code in callback URL'));
      }
    });

    server.listen(port, () => {
      console.error(`Listening for callback on http://localhost:${port}`);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });

  const res = await fetch(`${STRAVA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as TokenResponse & { message?: string };
  if (!res.ok) {
    throw new Error(data.message ?? `Token exchange failed: ${res.status}`);
  }
  return data;
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(`${STRAVA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as TokenResponse & { message?: string };
  if (!res.ok) {
    throw new Error(data.message ?? `Token refresh failed: ${res.status}`);
  }
  return data;
}

async function fetchActivities(opts: {
  perPage?: number;
  page?: number;
  before?: number;
  after?: number;
}): Promise<SummaryActivity[]> {
  const tokens = getTokens();
  const params = new URLSearchParams();
  if (opts.perPage != null && Number.isFinite(opts.perPage)) {
    params.set('per_page', String(Math.min(200, Math.max(1, opts.perPage))));
  }
  if (opts.page != null && Number.isFinite(opts.page)) {
    params.set('page', String(Math.max(1, opts.page)));
  }
  if (opts.before != null && Number.isFinite(opts.before)) {
    params.set('before', String(opts.before));
  }
  if (opts.after != null && Number.isFinite(opts.after)) {
    params.set('after', String(opts.after));
  }

  const url = `${STRAVA_API_BASE}/athlete/activities?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    let message = `Strava API error: ${res.status} ${res.statusText}`;
    try {
      const json = JSON.parse(body);
      if (json.message) message = `Strava API error: ${json.message}`;
    } catch {
      if (body) message += `\n${body}`;
    }
    throw new Error(message);
  }

  return res.json() as Promise<SummaryActivity[]>;
}

async function fetchActivity(id: number): Promise<Record<string, unknown>> {
  const tokens = getTokens();
  const res = await fetch(`${STRAVA_API_BASE}/activities/${id}`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    let message = `Strava API error: ${res.status} ${res.statusText}`;
    try {
      const json = JSON.parse(body) as { message?: string };
      if (json.message) message = `Strava API error: ${json.message}`;
    } catch {
      if (body) message += `\n${body}`;
    }
    throw new Error(message);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function printActivitiesTable(activities: SummaryActivity[]): void {
  if (activities.length === 0) {
    console.log('No activities found.');
    return;
  }

  const maxName = Math.min(
    40,
    Math.max(10, ...activities.map((a) => a.name.length))
  );
  const header =
    'Date'.padEnd(18) +
    'Type'.padEnd(14) +
    'Name'.padEnd(maxName + 2) +
    'Distance'.padEnd(12) +
    'Time';
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const activity of activities) {
    const date = formatDate(activity.start_date_local);
    const type = (activity.sport_type || activity.type || '').slice(0, 12);
    const name = activity.name.slice(0, maxName).padEnd(maxName + 2);
    const distance = formatDistance(activity.distance).padEnd(12);
    const time = formatDuration(activity.moving_time);
    console.log(`${date}  ${type.padEnd(14)}${name}${distance}${time}`);
  }
}

function _printTokenOutput(tokens: TokenResponse, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(tokens, null, 2));
    return;
  }
  console.log('Access token (set STRAVA_ACCESS_TOKEN):');
  console.log(tokens.access_token);
  console.log('\nRefresh token (store for token refresh):');
  console.log(tokens.refresh_token);
  console.log('\nNext, run this to store the tokens:');
  console.log(
    `greg hub strava auth store --access-token "${tokens.access_token}" --refresh-token "${tokens.refresh_token}"`
  );
  console.log(`\nExpires in ${Math.round(tokens.expires_in / 3600)} hours`);
}

const program = new Command();

program
  .name('strava')
  .description(
    'CLI to fetch latest activities from Strava (requires STRAVA_ACCESS_TOKEN, obtain via `strava auth`).'
  );

program
  .command('auth')
  .description(
    'Retrieve access token using client ID and secret (OAuth flow or with --code).'
  )
  .option(
    '--code <code>',
    'Authorization code from redirect (skips opening browser)'
  )
  .option(
    '--redirect-port <number>',
    'Port for OAuth callback when not using --code',
    (v: string) => parseInt(v, 10),
    DEFAULT_REDIRECT_PORT
  )
  .action(async (opts: { code?: string; redirectPort: number }) => {
    const storagePath = getStoragePath();
    const { clientId, clientSecret } = getClientCredentials();

    try {
      let code: string;
      if (opts.code) {
        code = opts.code.trim();
      } else {
        const redirectUri = `http://localhost:${opts.redirectPort}`;
        const authUrl = new URL(`${STRAVA_OAUTH_BASE}/authorize`);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', ACTIVITY_READ_SCOPE);
        const url = authUrl.toString();
        console.error(
          'Opening browser for Strava authorization. Set your app callback to',
          redirectUri
        );
        openUrl(url);
        code = await listenForCode(opts.redirectPort);
      }

      const tokens = await exchangeCodeForToken(clientId, clientSecret, code);
      fs.writeFileSync(storagePath, JSON.stringify(tokens, null, 2), 'utf8');
      console.log(`Tokens saved to ${storagePath}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('refresh')
  .description(
    'Get a new access token using client ID, secret, and refresh token.'
  )
  .action(async (_opts: Record<string, never>) => {
    const { clientId, clientSecret } = getClientCredentials();
    const storagePath = getStoragePath();
    if (!fs.existsSync(storagePath)) {
      console.error(`${storagePath} does not exist. Run strava auth.`);
      process.exit(1);
    }

    const tokens = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      console.error(
        `Refresh token not found in ${storagePath}. Run strava auth.`
      );
      process.exit(1);
    }

    try {
      const tokens = await refreshAccessToken(
        clientId,
        clientSecret,
        refreshToken
      );
      fs.writeFileSync(storagePath, JSON.stringify(tokens, null, 2), 'utf8');
      console.log(`Tokens saved to ${storagePath}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('activity <id>')
  .description('Fetch a single activity by ID with full details (outputs JSON)')
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      console.error('Activity ID must be a number');
      process.exit(1);
    }
    try {
      const activity = await fetchActivity(id);
      console.log(JSON.stringify(activity, null, 2));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('activities')
  .description('Fetch the latest activities from your Strava profile')
  .option(
    '-n, --per-page <number>',
    'Number of activities per page (1–200)',
    (v: string) => parseInt(v, 10),
    30
  )
  .option(
    '-p, --page <number>',
    'Page number for pagination',
    (v: string) => parseInt(v, 10),
    1
  )
  .option(
    '--before <unix>',
    'Unix timestamp: only activities before this time',
    (v: string) => parseInt(v, 10)
  )
  .option(
    '--after <unix>',
    'Unix timestamp: only activities after this time',
    (v: string) => parseInt(v, 10)
  )
  .option('--json', 'Output raw JSON instead of a table')
  .action(
    async (opts: {
      perPage: number;
      page: number;
      before?: number;
      after?: number;
      json?: boolean;
    }) => {
      try {
        const activities = await fetchActivities({
          perPage: opts.perPage,
          page: opts.page,
          before: opts.before,
          after: opts.after,
        });
        if (opts.json) {
          console.log(JSON.stringify(activities, null, 2));
        } else {
          printActivitiesTable(activities);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  );

export const stravaCommand = program;
