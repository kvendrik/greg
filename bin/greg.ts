#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { name, description, version } from '../package.json';
import type { Config } from '../config';
import pc from 'picocolors';
import { sendMessage } from '../clients/telegram/messaging';

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
      .option('-d, --detached', 'Do not follow logs after start')
      .action(async (options: { detached?: boolean }) => {
        await runServiceStart(serviceConfig);
        if (options.detached) return;

        spawnSync('bun', ['run', serviceConfig.scripts.logs], {
          stdio: 'inherit',
          cwd: projectRoot,
        });
      })
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
  .addCommand(
    new Command('send')
      .description('Send a message to the configured Telegram user')
      .option('--voice', 'send the message as a voice message')
      .argument('<message>', 'message to send')
      .action(
        async (
          message: string,
          options: { voice?: boolean; awaitReply?: boolean }
        ) => {
          await sendMessage(message, {
            voice: options.voice ?? false,
          });

          const log = options.voice
            ? '📤 Sent & delivered as voice message'
            : '📤 Sent & delivered as text message';

          console.log(pc.green(log));

          process.exit(0);
        }
      )
  );

program
  .command('config')
  .description('Manage Greg’s config')
  .addCommand(
    new Command('validate')
      .description('Validate the config file')
      .action(async () => {
        const config = await loadConfig();
        const { validate } = await import('../config');
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
    const { validate } = await import('../config');
    const { discoverSkills } = await import('../agent/tools/skills');
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

const heartbeatCommand = new Command('heartbeat').description(
  'Control heartbeat (periodic main-session runs). Uses workspace from config.'
);

heartbeatCommand
  .alias('hb')
  .addCommand(
    new Command('run')
      .description('Run a heartbeat immediately')
      .action(async () => {
        const heartbeat = await import('../gateway/heartbeat');
        const hb = new heartbeat.Heartbeat();
        await hb.run();
      })
  )
  .addCommand(
    new Command('status')
      .description('Show heartbeat status: enabled, paused, and recent runs')
      .option('--lines <n>', 'Max number of runs to show', '20')
      .option('--json', 'Machine-readable output')
      .action(async (opts: { lines?: string; json?: boolean }) => {
        const config = await loadConfig();
        const heartbeat = await import('../gateway/heartbeat');
        const enabled = config.heartbeat?.enabled === false ? false : true;
        const paused = await heartbeat.isPaused();
        const limit = Math.max(
          1,
          Math.min(1000, parseInt(opts.lines ?? '20', 10) || 20)
        );

        const runs = await heartbeat.get(limit);

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
        const heartbeat = await import('../gateway/heartbeat');
        await heartbeat.setPaused(false);
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
        const heartbeat = await import('../gateway/heartbeat');
        await heartbeat.setPaused(true);

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
        const heartbeat = await import('../gateway/heartbeat');
        const entries = await heartbeat.get();
        const entry = entries.length > 0 ? entries[entries.length - 1] : null;

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

const hubCommand = new Command('hub').description(
  'Run hub modules (Notion, Strava, etc.)'
);

const { hubCommands } = await import('../hub');

for (const cmd of hubCommands) {
  hubCommand.addCommand(cmd);
}

program.addCommand(hubCommand);

program
  .command('sessions')
  .description('Inspect Greg sessions')
  .addCommand(
    new Command('list')
      .description('List known session IDs')
      .action(async () => {
        try {
          const sdk = await import('../gateway/sdk/sdk');
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
      .argument('<sessionId>', 'ID of the session to create')
      .argument('<channelId>', 'Channel ID')
      .action(async (sessionId: string, channelId: string) => {
        try {
          const sdk = await import('../gateway/sdk/sdk');
          const session = await sdk.Session.create(sessionId, channelId);
          console.log(pc.green('Session created.'));
          console.log(
            pc.gray(
              `Use \`greg sessions prompt ${sessionId} ${channelId} <text>\` to send a prompt.`
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
    new Command('presence')
      .description(
        'List all sessions and their connected clients (IP and channel)'
      )
      .action(async () => {
        try {
          const sdk = await import('../gateway/sdk/sdk');
          const sessionIds = await sdk.listSessions();

          if (!sessionIds.length) {
            console.log('No sessions found.');
            console.log(pc.gray('Run `greg sessions create` to create one.'));
            return;
          }

          for (const sessionId of sessionIds) {
            const { clients } = await sdk.getSessionPresence(sessionId);
            console.log(pc.bold(sessionId));
            if (clients.length === 0) {
              console.log(pc.gray('  (no connected clients)'));
            } else {
              for (const { ip, channelId } of clients) {
                console.log(`  ${ip}  ${pc.cyan(channelId)}`);
              }
            }
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
    new Command('prompt')
      .description('Send a prompt to an existing session')
      .argument('<sessionId>', 'ID of the session to prompt')
      .argument('<channelId>', 'Channel ID')
      .argument('<text>', 'Prompt text')
      .action(
        async (sessionId: string, channelId: string, promptText: string) => {
          if (!promptText) {
            console.error(pc.red('No prompt text provided.'));
            process.exitCode = 1;
            return;
          }

          let session;
          try {
            const sdk = await import('../gateway/sdk/sdk');
            session = await sdk.Session.existing(sessionId, channelId);
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
        }
      )
  )
  .addCommand(
    new Command('logs')
      .description('Print logs for session')
      .argument('<sessionId>', 'ID of the session')
      .action(async (sessionId: string) => {
        const storage = await import('../gateway/sessions/storage/storage');

        if (!storage.exists(sessionId)) {
          console.error(pc.red(`Session ${sessionId} not found.`));
          process.exit(1);
        }

        const session = await storage.load(sessionId);
        console.log(JSON.stringify(session.messages, null, 2));
      })
  )
  .addCommand(
    new Command('compact')
      .description('Compaction commands for a session')
      .addCommand(
        new Command('test')
          .description(
            'Returns compacted session for a session without saving it'
          )
          .argument('<sessionId>', 'ID of the session')
          .action(async (sessionId: string) => {
            const storage = await import('../gateway/sessions/storage/storage');

            if (!storage.exists(sessionId)) {
              console.error(pc.red(`Session ${sessionId} not found.`));
              process.exit(1);
            }

            const session = await storage.load(sessionId);
            const config = await loadConfig();
            const { compact } = await import('../agent/compaction');

            const result = await compact(session.messages, {
              config,
              signal: new AbortController().signal,
            });

            console.log(result);
          })
      )
  );

program
  .command('voice')
  .description('Talk to Greg by voice.')
  .option(
    '-d, --device <index>',
    'AVFoundation microphone device index (default: prompt to choose)'
  )
  .action(async () => {
    const { voiceCommand } = await import('../scripts/voice/index');
    await voiceCommand.parseAsync(
      process.argv.slice(process.argv.indexOf('voice'))
    );
  });

program.parse();
