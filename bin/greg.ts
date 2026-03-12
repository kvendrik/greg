#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { name, description, version } from '../package.json';
import * as sdk from '../gateway/sdk/sdk';
import { validate, type Config } from '../config';
import {
  readJobs,
  writeJobs,
  getJobsPath,
  generateJobId,
  formatSchedule,
  validateSchedule,
  readRuns,
} from '../agent/tools/cron';
import type { CronJob } from '../agent/tools/cron';
import { discoverSkills } from '../agent/tools/skills';
import { sendCommand } from '../clients/telegram/send-message';
import {
  resolveWorkspacePath,
  getLastHeartbeatRun,
  getHeartbeatRuns,
  isHeartbeatPaused,
  setHeartbeatPaused,
} from '../gateway/heartbeat';
import { voiceCommand } from '../scripts/voice/index';
import pc from 'picocolors';

const projectRoot = path.join(import.meta.dirname, '..');

async function loadConfig(): Promise<Config> {
  try {
    const { default: config } = await import('../.greg');
    return config as Config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      pc.red('Config not found or invalid.'),
      pc.gray(`(${message})`)
    );
    process.exit(1);
  }
}

const program = new Command();

type ServiceScripts = {
  start:
    | string
    | { cmd: string; getEnv: () => Promise<Record<string, string>> };
  stop: string;
  restart: string;
  logs: string;
};

type ServiceConfig = {
  name: string;
  description: string;
  pm2ProcessName: string;
  scripts: ServiceScripts;
  label: string;
  logsHint: string;
  checkPm2BeforeStart: boolean;
  descriptions: {
    start: string;
    status: string;
    stop: string;
    restart: string;
    logs: string;
  };
  statusExtra?: () => void;
};

function getPm2StatusByProcessName(): Map<string, string> {
  const result = spawnSync('bunx', ['pm2', 'jlist'], {
    stdio: 'pipe',
    cwd: projectRoot,
    encoding: 'utf-8',
  });
  const map = new Map<string, string>();
  if (result.status !== 0 || !result.stdout) return map;
  try {
    const processes: { name?: string; pm2_env?: { status?: string } }[] =
      JSON.parse(result.stdout);
    for (const proc of processes) {
      const name = proc.name;
      const status = proc.pm2_env?.status;
      if (name != null && status != null) map.set(name, status);
    }
  } catch {
    // ignore parse errors
  }
  return map;
}

async function runServiceStatus(
  serviceConfig: ServiceConfig,
  options: { pm2Status?: string } = {}
): Promise<void> {
  const pm2Status =
    options.pm2Status ??
    getPm2StatusByProcessName().get(serviceConfig.pm2ProcessName);
  const running = pm2Status === 'online';
  const hasErrors = pm2Status === 'errored';

  console.log(pc.bold(serviceConfig.label));
  await serviceConfig.statusExtra?.();
  console.log(`Running: ${running ? pc.green('yes') : pc.red('no')}`);
  if (running) {
    if (hasErrors) {
      console.log(
        `Status: ${pc.red('errors')} (run \`greg ${serviceConfig.name} logs\` to see logs)`
      );
    } else {
      console.log(`Status: ${pc.green('ok')}`);
    }
  }
}

async function runServiceStart(
  serviceConfig: ServiceConfig,
  options: { exitIfAlreadyRunning?: boolean } = {}
): Promise<void> {
  const { exitIfAlreadyRunning = true } = options;
  if (serviceConfig.checkPm2BeforeStart) {
    const statusResult = spawnSync(
      'bunx',
      ['pm2', 'describe', serviceConfig.pm2ProcessName],
      { stdio: 'pipe', cwd: projectRoot }
    );
    if (statusResult.status === 0) {
      console.log(pc.green(serviceConfig.logsHint));
      if (exitIfAlreadyRunning) process.exit(0);
      return;
    }
  }
  const startScript = serviceConfig.scripts.start;
  if (typeof startScript === 'object') {
    spawnSync('bun', ['run', startScript.cmd], {
      stdio: 'inherit',
      cwd: projectRoot,
      env: { ...process.env, ...(await startScript.getEnv()) },
    });
  } else {
    spawnSync('bun', ['run', startScript], {
      stdio: 'inherit',
      cwd: projectRoot,
      env: { ...process.env },
    });
  }
}

function runServiceStop(serviceConfig: ServiceConfig): number | null {
  const result = spawnSync('bun', ['run', serviceConfig.scripts.stop], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  return result.status;
}

function runServiceRestart(serviceConfig: ServiceConfig): number | null {
  const result = spawnSync('bun', ['run', serviceConfig.scripts.restart], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  return result.status;
}

function createServiceCommand(serviceConfig: ServiceConfig): Command {
  const cmd = new Command(serviceConfig.name).description(
    serviceConfig.description
  );

  cmd.addCommand(
    new Command('start')
      .description(serviceConfig.descriptions.start)
      .action(() => runServiceStart(serviceConfig))
  );

  cmd.addCommand(
    new Command('status')
      .alias('s')
      .description(serviceConfig.descriptions.status)
      .action(() => {
        runServiceStatus(serviceConfig);
      })
  );

  cmd.addCommand(
    new Command('stop')
      .description(serviceConfig.descriptions.stop)
      .action(() => process.exit(runServiceStop(serviceConfig) ?? 0))
  );

  cmd.addCommand(
    new Command('restart')
      .description(serviceConfig.descriptions.restart)
      .action(() => process.exit(runServiceRestart(serviceConfig) ?? 0))
  );

  cmd.addCommand(
    new Command('logs')
      .alias('l')
      .description(serviceConfig.descriptions.logs)
      .option('-n, --lines <number>', 'Number of lines to show')
      .option('-s, --stream', 'Stream the logs')
      .action(
        ({
          lines = '50',
          stream = false,
        }: {
          lines?: string;
          stream?: boolean;
        }) => {
          spawnSync(
            'bun',
            [
              'run',
              serviceConfig.scripts.logs,
              ...(lines ? ['--lines', lines] : []),
              ...(stream ? [] : ['--nostream']),
            ],
            { stdio: 'inherit', cwd: projectRoot }
          );
        }
      )
  );

  return cmd;
}

program
  .name(name)
  .description(
    `${description}.\nSee ${path.join(projectRoot, 'README.md')} for details.`
  )
  .version(version);

const gatewayCommand = createServiceCommand({
  name: 'gateway',
  description: 'Manage Greg gateway (start, stop, restart, status, logs)',
  pm2ProcessName: 'greg:gateway',
  scripts: {
    start: 'gateway',
    stop: 'gateway:stop',
    restart: 'gateway:restart',
    logs: 'gateway:logs',
  },
  label: '🌉 Gateway',
  logsHint: 'Greg is already running. Run `greg gateway logs` to see the logs.',
  checkPm2BeforeStart: true,
  descriptions: {
    start: 'Starts Greg gateway',
    status: 'Gets Greg gateway status',
    stop: 'Stops Greg gateway',
    restart: 'Restarts Greg gateway',
    logs: 'Shows Greg gateway logs',
  },
});

gatewayCommand.alias('gw');
program.addCommand(gatewayCommand);

program
  .command('telegram')
  .alias('tg')
  .description('Telegram messaging tools')
  .addCommand(sendCommand);

program
  .command('config')
  .description('Manage Greg’s config')
  .addCommand(
    new Command('validate')
      .description('Validate the config file')
      .action(async () => {
        const config = await loadConfig();
        await validate(config);
      })
  )
  .addCommand(
    new Command('path')
      .description('Get the current config path')
      .action(() => {
        const tsPath = path.join(projectRoot, '.greg.ts');
        const jsPath = path.join(projectRoot, '.greg.js');
        console.log(
          existsSync(tsPath) ? tsPath : existsSync(jsPath) ? jsPath : tsPath
        );
      })
  );

program
  .command('doctor')
  .description(
    'Validate config and check skill dependencies (CLIs and env vars from skill requires)'
  )
  .action(async () => {
    const config = await loadConfig();
    const configFailures = await validate(config, { exit: false });
    const skills = discoverSkills(config);
    for (const skill of skills) {
      if (!skill.requires?.length) continue;
      for (const req of skill.requires) {
        const isEnv = req.startsWith('env:');
        const key = isEnv ? req.slice(4) : req;
        if (isEnv) {
          const value = process.env[key];
          if (value === undefined || value === '') {
            console.warn(
              pc.yellow(
                `Warning: skill "${skill.name}" cannot be used — env ${key} is not set`
              )
            );
          } else {
            console.log(
              pc.green(`Skill "${skill.name}": env ${key} ${pc.green('✓')}`)
            );
          }
        } else {
          const result = spawnSync('which', [key], {
            encoding: 'utf8',
            stdio: 'pipe',
          });
          if (result.status !== 0) {
            console.warn(
              pc.yellow(
                `Warning: skill "${skill.name}" cannot be used — CLI "${key}" not found`
              )
            );
          } else {
            console.log(
              pc.green(`Skill "${skill.name}": ${key} ${pc.green('✓')}`)
            );
          }
        }
      }
    }
    if (configFailures.length > 0) {
      console.error(pc.red('Config validation failed.'));
    }
    process.exit(configFailures.length > 0 ? 1 : 0);
  });

program
  .command('tools')
  .description('Use Greg’s tools directly from the command line')
  .allowUnknownOption()
  .action(() => {
    const args = program.args.slice(1);
    spawn('bun', ['run', 'gateway:tools', ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    }).on('exit', (code) => process.exit(code ?? 0));
  });

const cronCommand = new Command('cron').description(
  'Manage scheduled cron jobs (stored in workspace/cron/jobs.json)'
);

cronCommand
  .addCommand(
    new Command('add')
      .description(
        'Add a scheduled job (use exactly one of --cron, --every, --at)'
      )
      .option(
        '--cron <expr>',
        '6-field cron: second minute hour day month weekday (e.g. "0 0 18 * * *" for 6pm daily)'
      )
      .option(
        '--every <ms>',
        'Run every N milliseconds (e.g. 60000 for every minute)',
        (v) => parseInt(v, 10)
      )
      .option(
        '--at <iso>',
        'One-shot at ISO 8601 date/time (e.g. 2025-03-20T09:00:00Z)'
      )
      .requiredOption(
        '--prompt <text>',
        'Prompt sent to the agent when the job runs'
      )
      .option('--name <name>', 'Optional short name for the job')
      .option('--tz <iana>', 'IANA timezone for --cron (e.g. Europe/Amsterdam)')
      .option('--stagger <ms>', 'Delay execution by N ms to spread load', (v) =>
        parseInt(v, 10)
      )
      .option('--delete-after-run', 'For --at: remove job after it runs once')
      .action(
        async (opts: {
          cron?: string;
          every?: number;
          at?: string;
          prompt: string;
          name?: string;
          tz?: string;
          stagger?: number;
          deleteAfterRun?: boolean;
        }) => {
          const config = await loadConfig();
          const hasCron = opts.cron != null && String(opts.cron).trim() !== '';
          const hasEvery = opts.every != null && Number.isFinite(opts.every);
          const hasAt = opts.at != null && String(opts.at).trim() !== '';
          if ([hasCron, hasEvery, hasAt].filter(Boolean).length !== 1) {
            console.error(
              pc.red(
                'Provide exactly one of: --cron <expr>, --every <ms>, --at <iso>'
              )
            );
            process.exitCode = 1;
            return;
          }
          let schedule: CronJob['schedule'];
          if (hasCron) {
            schedule = {
              kind: 'cron',
              expr: opts.cron!.trim(),
              ...(opts.tz?.trim() && { tz: opts.tz.trim() }),
            };
          } else if (hasEvery) {
            schedule = { kind: 'every', everyMs: opts.every! };
          } else {
            schedule = { kind: 'at', at: opts.at!.trim() };
          }
          const validation = validateSchedule(schedule);
          if (!validation.valid) {
            console.error(pc.red(validation.error ?? 'Invalid schedule.'));
            process.exitCode = 1;
            return;
          }
          const job: CronJob = {
            id: generateJobId(),
            schedule,
            jobPrompt: opts.prompt.trim(),
            enabled: true,
          };
          if (opts.name?.trim()) job.name = opts.name.trim();
          if (opts.stagger != null && opts.stagger >= 0)
            job.staggerMs = opts.stagger;
          if (opts.deleteAfterRun === true && schedule.kind === 'at')
            job.deleteAfterRun = true;
          const jobs = await readJobs(config);
          jobs.push(job);
          await writeJobs(config, jobs);
          console.log(pc.green(`Added job ${job.id}`));
          console.log(`  schedule: ${formatSchedule(schedule)}`);
          console.log(
            `  jobPrompt: ${job.jobPrompt.slice(0, 60)}${job.jobPrompt.length > 60 ? '...' : ''}`
          );
        }
      )
  )
  .addCommand(
    new Command('runs')
      .description(
        'Show recent cron run history (from workspace/cron/runs/runs.jsonl)'
      )
      .option('-n, --limit <number>', 'Max number of runs to show', '50')
      .action(async (opts: { limit?: string }) => {
        const config = await loadConfig();
        const limit = Math.min(
          500,
          Math.max(1, parseInt(opts.limit ?? '50', 10) || 50)
        );
        const runs = await readRuns(config, limit);
        if (runs.length === 0) {
          console.log(pc.gray('No runs recorded.'));
          return;
        }
        for (const r of runs) {
          const status = r.success === true ? pc.green('ok') : pc.red('fail');
          const end = r.finishedAt ?? '-';
          const err = r.error ? ` ${pc.red(r.error)}` : '';
          console.log(
            `${r.startedAt} | ${pc.cyan(r.jobId)} | ${status} | ${end}${err}`
          );
        }
      })
  )
  .addCommand(
    new Command('update')
      .description('Update a job by id (omit options to leave unchanged)')
      .argument('<jobId>', 'Job id from cron list')
      .option('--cron <expr>', 'Set schedule to cron expression')
      .option('--tz <iana>', 'IANA timezone (with --cron)')
      .option('--every <ms>', 'Set schedule to every N ms', (v) =>
        parseInt(v, 10)
      )
      .option('--at <iso>', 'Set schedule to one-shot at ISO date')
      .option('--prompt <text>', 'New prompt text')
      .option('--name <name>', 'New name')
      .option(
        '--enabled <bool>',
        'Enable or disable job (true|false)',
        (v) => v === 'true'
      )
      .option('--stagger <ms>', 'Stagger delay in ms', (v) => parseInt(v, 10))
      .option(
        '--delete-after-run',
        'Remove job after it runs (for at schedule)'
      )
      .option('--no-delete-after-run', 'Clear delete-after-run')
      .action(
        async (
          jobId: string,
          opts: {
            cron?: string;
            tz?: string;
            every?: number;
            at?: string;
            prompt?: string;
            name?: string;
            enabled?: boolean;
            stagger?: number;
            deleteAfterRun?: boolean;
            noDeleteAfterRun?: boolean;
          }
        ) => {
          const config = await loadConfig();
          const jobs = await readJobs(config);
          const job = jobs.find((j) => j.id === jobId);
          if (!job) {
            console.error(pc.red(`Job ${jobId} not found.`));
            process.exitCode = 1;
            return;
          }
          const hasCron = opts.cron != null && String(opts.cron).trim() !== '';
          const hasEvery = opts.every != null && Number.isFinite(opts.every);
          const hasAt = opts.at != null && String(opts.at).trim() !== '';
          const scheduleOpts = [hasCron, hasEvery, hasAt].filter(
            Boolean
          ).length;
          if (scheduleOpts > 1) {
            console.error(
              pc.red('Provide at most one of: --cron, --every, --at')
            );
            process.exitCode = 1;
            return;
          }
          if (scheduleOpts === 1) {
            if (hasCron) {
              job.schedule = {
                kind: 'cron',
                expr: opts.cron!.trim(),
                ...(opts.tz?.trim() && { tz: opts.tz.trim() }),
              };
            } else if (hasEvery) {
              job.schedule = { kind: 'every', everyMs: opts.every! };
            } else {
              job.schedule = { kind: 'at', at: opts.at!.trim() };
            }
            const validation = validateSchedule(job.schedule);
            if (!validation.valid) {
              console.error(pc.red(validation.error ?? 'Invalid schedule.'));
              process.exitCode = 1;
              return;
            }
          }
          if (opts.prompt !== undefined) {
            const trimmed = opts.prompt.trim();
            if (!trimmed) {
              console.error(pc.red('Prompt cannot be empty.'));
              process.exitCode = 1;
              return;
            }
            job.jobPrompt = trimmed;
          }
          if (opts.name !== undefined) job.name = opts.name.trim() || undefined;
          if (opts.enabled !== undefined) job.enabled = opts.enabled;
          if (opts.stagger !== undefined)
            job.staggerMs = opts.stagger >= 0 ? opts.stagger : undefined;
          if (opts.deleteAfterRun === true) job.deleteAfterRun = true;
          if (opts.noDeleteAfterRun === true) job.deleteAfterRun = false;
          await writeJobs(config, jobs);
          console.log(pc.green(`Updated job ${jobId}.`));
        }
      )
  )
  .addCommand(
    new Command('list')
      .description('List all scheduled jobs')
      .action(async () => {
        const config = await loadConfig();
        const jobs = await readJobs(config);
        if (jobs.length === 0) {
          console.log(pc.gray(`No jobs in ${getJobsPath(config)}`));
          return;
        }
        for (const j of jobs) {
          console.log(
            pc.cyan(j.id),
            formatSchedule(j.schedule),
            j.name ?? '-',
            `| ${j.jobPrompt.slice(0, 50)}${j.jobPrompt.length > 50 ? '...' : ''}`
          );
        }
      })
  )
  .addCommand(
    new Command('remove')
      .description('Remove a job by id')
      .argument('<jobId>', 'Job id from cron list')
      .action(async (jobId: string) => {
        const config = await loadConfig();
        const jobs = await readJobs(config);
        const index = jobs.findIndex((j) => j.id === jobId);
        if (index === -1) {
          console.error(pc.red(`Job ${jobId} not found.`));
          process.exitCode = 1;
          return;
        }
        jobs.splice(index, 1);
        await writeJobs(config, jobs);
        console.log(pc.green(`Removed job ${jobId}.`));
      })
  )
  .addCommand(
    new Command('run')
      .description('Run a job immediately (gateway must be running)')
      .argument('<jobId>', 'Job id from cron list')
      .action(async (jobId: string) => {
        const config = await loadConfig();
        const jobs = await readJobs(config);
        const job = jobs.find((j) => j.id === jobId);
        if (!job) {
          console.error(pc.red(`Job ${jobId} not found.`));
          process.exitCode = 1;
          return;
        }
        try {
          const session = await sdk.Session.existing('cron');
          await session.connect();
          await session.prompt({ content: job.jobPrompt, images: [] });
          console.log(pc.green('Job run completed.'));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            pc.red(
              `Failed to run job: ${message}. Ensure \`greg gateway\` is running.`
            )
          );
          process.exitCode = 1;
        }
      })
  );

program.addCommand(cronCommand);

const heartbeatCommand = new Command('heartbeat').description(
  'Control heartbeat (periodic main-session runs). Uses workspace from config.'
);

heartbeatCommand
  .addCommand(
    new Command('status')
      .description('Show heartbeat status: enabled, paused, and recent runs')
      .option('--lines <n>', 'Max number of runs to show', '20')
      .option('--json', 'Machine-readable output')
      .action(async (opts: { lines?: string; json?: boolean }) => {
        const config = await loadConfig();
        const workspacePath = resolveWorkspacePath(config.workspace);
        const enabled = config.heartbeat?.enabled === false ? false : true;
        const paused = await isHeartbeatPaused(workspacePath);
        const limit = Math.max(
          1,
          Math.min(1000, parseInt(opts.lines ?? '20', 10) || 20)
        );

        const runs = await getHeartbeatRuns(workspacePath, limit);

        if (opts.json) {
          console.log(
            JSON.stringify({
              enabled,
              paused,
              runs,
            })
          );
          return;
        }

        console.log(pc.bold('Heartbeat status'));
        console.log(`  Enabled:  ${enabled ? pc.green('yes') : pc.red('no')}`);
        console.log(
          `  Paused:   ${paused ? pc.yellow('yes') : pc.green('no')}`
        );
        console.log('');
        console.log(pc.bold(`Recent runs (last ${runs.length})`));
        if (runs.length === 0) {
          console.log(pc.gray('  No runs recorded yet.'));
          return;
        }
        for (const entry of runs) {
          const status = entry.success ? pc.green('ok') : pc.red('fail');
          const err = entry.error ? ` — ${entry.error}` : '';
          console.log(
            `  ${entry.startedAt} … ${entry.finishedAt}  ${status}${pc.gray(err)}`
          );
        }
      })
  )
  .addCommand(
    new Command('enable')
      .description('Turn heartbeats on (remove pause)')
      .option('--json', 'Machine-readable output')
      .action(async (opts: { json?: boolean }) => {
        const config = await loadConfig();
        const workspacePath = resolveWorkspacePath(config.workspace);
        await setHeartbeatPaused(workspacePath, false);
        if (opts.json) {
          console.log(JSON.stringify({ paused: false }));
        } else {
          console.log(pc.green('Heartbeat enabled.'));
        }
      })
  )
  .addCommand(
    new Command('disable')
      .description('Pause heartbeats')
      .option('--json', 'Machine-readable output')
      .action(async (opts: { json?: boolean }) => {
        const config = await loadConfig();
        const workspacePath = resolveWorkspacePath(config.workspace);
        await setHeartbeatPaused(workspacePath, true);
        if (opts.json) {
          console.log(JSON.stringify({ paused: true }));
        } else {
          console.log(pc.yellow('Heartbeat paused.'));
        }
      })
  )
  .addCommand(
    new Command('last')
      .description(
        'Show the last heartbeat run (from workspace/heartbeat/runs.jsonl)'
      )
      .option('--json', 'Machine-readable output')
      .action(async (opts: { json?: boolean }) => {
        const config = await loadConfig();
        const workspacePath = resolveWorkspacePath(config.workspace);
        const entry = await getLastHeartbeatRun(workspacePath);
        if (opts.json) {
          console.log(JSON.stringify(entry ?? null));
          return;
        }
        if (entry == null) {
          console.log(pc.gray('No heartbeat runs recorded yet.'));
          return;
        }
        console.log(pc.bold('Last heartbeat run'));
        console.log(`  Started:  ${entry.startedAt}`);
        console.log(`  Finished: ${entry.finishedAt}`);
        console.log(
          `  Success:  ${entry.success ? pc.green('yes') : pc.red('no')}`
        );
        if (entry.error) {
          console.log(`  Error:    ${entry.error}`);
        }
      })
  );

program.addCommand(heartbeatCommand);

program
  .command('sessions')
  .description('Inspect Greg sessions')
  .addCommand(
    new Command('list')
      .description('List known session IDs')
      .action(async () => {
        try {
          const sessionIds = await sdk.listSessions();
          if (!sessionIds.length) {
            console.log('No sessions found.');
            console.log(pc.gray('Run `greg sessions create` to create one.'));
            return;
          }
          for (const sessionId of sessionIds) {
            console.log(sessionId);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(pc.red(message));
          process.exitCode = 1;
        }
      })
  )
  .addCommand(
    new Command('create')
      .description('Create a new session')
      .action(async () => {
        try {
          const session = await sdk.Session.create('cli');
          console.log(pc.green(`Session created: ${session.id}`));
          console.log(
            pc.gray(
              `Use \`greg sessions prompt ${session.id} <text>\` to send a prompt.`
            )
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(pc.red(message));
          process.exitCode = 1;
        }
      })
  )
  .addCommand(
    new Command('prompt')
      .description('Send a prompt to an existing session')
      .argument('<sessionId>', 'ID of the session to prompt')
      .argument('<text>', 'Prompt text')
      .action(async (sessionId: string, promptText: string) => {
        if (!promptText) {
          console.error(pc.red('No prompt text provided.'));
          process.exitCode = 1;
          return;
        }

        let session;
        try {
          session = await sdk.Session.existing(sessionId);
          await session.connect();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            pc.red(
              `Session not found or gateway not reachable: ${message}. Ensure the session exists and \`greg gateway\` is running.`
            )
          );
          process.exit(1);
        }

        session.subscribe({
          onThinking(chunk) {
            process.stdout.write(pc.gray(chunk));
          },
          onContent(chunk) {
            process.stdout.write(chunk);
          },
          onToolcall(name, args) {
            const label =
              args && Object.keys(args).length
                ? `${name}(${JSON.stringify(args)})`
                : name;
            process.stdout.write(`\n${pc.gray(`[toolcall] ${label}`)}\n`);
          },
          onTurnDone() {
            process.stdout.write('\n');
            process.exit(0);
          },
          onTurnStop() {
            process.stdout.write(pc.yellow('\n[stopped]\n'));
          },
          onError(error) {
            console.error(pc.red(`\nError: ${error}`));
            process.exit(1);
          },
        });

        await session.prompt({ content: promptText, images: [] });
      })
  );

program.addCommand(voiceCommand);

program.parse();
