#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { name, description, version } from '../package.json';
import * as sdk from '../gateway/sdk/sdk';
import { validate, type Config } from '../config';
import { discoverSkills } from '../agent/tools/skills';
import { sendCommand } from '../clients/telegram/send-message';
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

program.parse();
