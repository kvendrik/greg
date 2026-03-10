#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { Command } from 'commander';
import { name, description, version } from '../package.json';
import * as sdk from '../service/server/sdk/sdk';
import { TaskChannel } from '../clients/TaskChannel';
import { validate } from '../config';
import { discoverSkills } from '../service/Agent/tools/skills';
import { sendCommand } from '../clients/telegram/send-message';
import pc from 'picocolors';
import fs from 'node:fs';

const projectRoot = path.join(import.meta.dirname, '..');
const program = new Command();

const IDLE_MS = 3000;
const POLL_INTERVAL_MS = 500;
const WAIT_ONLINE_TIMEOUT_MS = 30000;
const WAIT_IDLE_TIMEOUT_MS = 15000;

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
  const result = spawnSync('bun', ['run', 'pm2', 'jlist'], {
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
      'bun',
      ['run', 'pm2', 'describe', serviceConfig.pm2ProcessName],
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

async function startServiceWithPipe(
  serviceConfig: ServiceConfig
): Promise<void> {
  const startScript = serviceConfig.scripts.start;
  if (typeof startScript === 'object') {
    spawnSync('bun', ['run', startScript.cmd], {
      stdio: 'pipe',
      cwd: projectRoot,
      env: { ...process.env, ...(await startScript.getEnv()) },
    });
  } else {
    spawnSync('bun', ['run', startScript], {
      stdio: 'pipe',
      cwd: projectRoot,
    });
  }
}

function waitForLogIdle(
  serviceConfig: ServiceConfig
): Promise<{ status: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', serviceConfig.scripts.logs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
    });
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resolveStatus = () => {
      if (idleTimer) clearTimeout(idleTimer);
      child.kill();
      const status =
        getPm2StatusByProcessName().get(serviceConfig.pm2ProcessName) ??
        'unknown';
      resolve({ status });
    };
    const scheduleIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(resolveStatus, IDLE_MS);
    };
    const onData = () => {
      scheduleIdle();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    scheduleIdle();
    setTimeout(() => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
        child.kill();
        const status =
          getPm2StatusByProcessName().get(serviceConfig.pm2ProcessName) ??
          'unknown';
        resolve({ status });
      }
    }, WAIT_IDLE_TIMEOUT_MS);
  });
}

async function startServiceAndWaitForIdle(
  serviceConfig: ServiceConfig
): Promise<boolean> {
  const statusMap = getPm2StatusByProcessName();
  const existing = statusMap.get(serviceConfig.pm2ProcessName);
  if (existing === 'online') {
    return true;
  }
  console.log(`Starting ${serviceConfig.label}...`);
  startServiceWithPipe(serviceConfig);
  const deadline = Date.now() + WAIT_ONLINE_TIMEOUT_MS;
  for (;;) {
    const status = getPm2StatusByProcessName().get(
      serviceConfig.pm2ProcessName
    );
    if (status === 'errored' || status === 'stopped') {
      console.log(pc.red('Needs attention.'));
      return false;
    }
    if (status === 'online') break;
    if (Date.now() >= deadline) {
      console.log(pc.red('Needs attention.'));
      return false;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  await waitForLogIdle(serviceConfig);
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  const status =
    getPm2StatusByProcessName().get(serviceConfig.pm2ProcessName) ?? 'unknown';
  const failed = status === 'errored' || status === 'stopped';
  if (failed) {
    console.log(pc.red('Needs attention.'));
    return false;
  }
  console.log(pc.green('Ready.'));
  return true;
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
    `${description}.\nSee ${path.resolve('./README.md')} for details.`
  )
  .version(version);

const agentServiceConfig: ServiceConfig = {
  name: 'agent',
  description: 'Manage Greg (start, stop, restart, status, logs)',
  pm2ProcessName: 'greg',
  scripts: {
    start: 'agent',
    stop: 'agent:stop',
    restart: 'agent:restart',
    logs: 'agent:logs',
  },
  label: '🤖 Agent',
  logsHint: 'Greg is already running. Run `greg agent logs` to see the logs.',
  checkPm2BeforeStart: true,
  descriptions: {
    start: 'Starts Greg',
    status: "Gets Greg's status",
    stop: 'Stops Greg',
    restart: 'Restarts Greg',
    logs: "Shows Greg's logs",
  },
};

const telegramServiceConfig: ServiceConfig = {
  name: 'telegram',
  description: 'Talk to Greg via Telegram',
  pm2ProcessName: 'greg:telegram',
  scripts: {
    start: 'clients:telegram:start',
    stop: 'clients:telegram:stop',
    restart: 'clients:telegram:restart',
    logs: 'clients:telegram:logs',
  },
  label: '📱 Telegram',
  logsHint:
    'Telegram client is already running. Run `greg telegram logs` to see the logs.',
  checkPm2BeforeStart: true,
  descriptions: {
    start: 'Start the Telegram client',
    status: 'Show whether the Telegram client is running',
    stop: 'Stop the Telegram client',
    restart: 'Restart the Telegram client',
    logs: "Show the Telegram client's logs",
  },
  statusExtra: async () => {
    const { default: config } = await import('../.greg');
    const enabled = config.clients?.telegram ?? false;
    console.log(`Enabled: ${enabled ? 'yes' : 'no'}`);
  },
};

const guardServiceConfig: ServiceConfig = {
  name: 'guard',
  description: 'Manage the prompt-injection guard',
  pm2ProcessName: 'greg:guard',
  scripts: {
    start: {
      cmd: 'guard:start',
      getEnv: async (): Promise<Record<string, string>> => {
        const { default: config } = await import('../.greg');
        return config.tools?.guard?.port != null
          ? { PORT: String(config.tools.guard.port) }
          : ({} as Record<string, string>);
      },
    },
    stop: 'guard:stop',
    restart: 'guard:restart',
    logs: 'guard:logs',
  },
  label: '💂 Guard',
  logsHint: 'Guard is already running. Run `greg guard logs` to see the logs.',
  checkPm2BeforeStart: true,
  descriptions: {
    start: 'Start the guard classifier service',
    status:
      'Show whether the guard is enabled in config and if the service is running',
    stop: 'Stop the guard classifier service',
    restart: 'Restart the guard classifier service',
    logs: "Show the guard's logs",
  },
  statusExtra: async () => {
    const { default: config } = await import('../.greg');
    const enabled = config.tools?.guard?.enabled ?? false;
    console.log(`Enabled: ${enabled ? 'yes' : 'no'}`);
  },
};

const jobsScheduleServiceConfig: ServiceConfig = {
  name: 'jobs:schedule',
  description: 'Manage the jobs schedule',
  pm2ProcessName: 'greg:jobs',
  scripts: {
    start: 'jobs:schedule',
    stop: 'jobs:schedule:stop',
    restart: 'jobs:schedule:restart',
    logs: 'jobs:schedule:logs',
  },
  label: '📅 Jobs Scheduler',
  logsHint:
    'Jobs schedule is already running. Run `greg jobs:schedule logs` to see the logs.',
  checkPm2BeforeStart: true,
  descriptions: {
    start: 'Start the jobs schedule',
    status: 'Show whether the jobs schedule is running',
    stop: 'Stop the jobs schedule',
    restart: 'Restart the jobs schedule',
    logs: "Show the jobs schedule's logs",
  },
};

const allServiceConfigs: ServiceConfig[] = [
  agentServiceConfig,
  telegramServiceConfig,
  guardServiceConfig,
  jobsScheduleServiceConfig,
];

const serviceConfigsStartOrder: ServiceConfig[] = [
  guardServiceConfig,
  agentServiceConfig,
  jobsScheduleServiceConfig,
  telegramServiceConfig,
];

program.addCommand(createServiceCommand(agentServiceConfig));

program
  .command('memory')
  .description('Manage Greg’s memory')
  .addCommand(
    new Command('index')
      .description(
        'Index the memory. Run after you’ve changed Markdown files in the workspace.'
      )
      .action(() => {
        spawn('bun', ['run', 'agent:memory:index'], {
          stdio: 'inherit',
          cwd: projectRoot,
        }).on('exit', (code) => process.exit(code ?? 0));
      })
  );

const telegramCmd = createServiceCommand(telegramServiceConfig);
telegramCmd.addCommand(sendCommand);
program.addCommand(telegramCmd);

program
  .command('config')
  .description('Manage Greg’s config')
  .addCommand(
    new Command('validate')
      .description('Validate the config file')
      .action(async () => {
        const { default: config } = await import('../.greg');
        await validate(config);
      })
  )
  .addCommand(
    new Command('path')
      .description('Get the current config path')
      .action(() => {
        console.log(path.resolve(projectRoot, '.greg.ts'));
      })
  );

program
  .command('doctor')
  .description(
    'Validate config and check skill dependencies (CLIs and env vars from skill requires)'
  )
  .action(async () => {
    const { default: config } = await import('../.greg');
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
    process.exit(configFailures.length > 0 ? 1 : 0);
  });

program
  .command('tools')
  .description('Use Greg’s tools directly from the command line')
  .allowUnknownOption()
  .action(() => {
    const args = program.args.slice(1);
    spawn('bun', ['run', 'agent:tools', ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    }).on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('jobs')
  .description('Manage scheduled jobs')
  .action(() => {
    const args = program.args.slice(1);
    spawn('bun', ['run', 'scripts/jobs', ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    }).on('exit', (code) => process.exit(code ?? 0));
  });

program.addCommand(createServiceCommand(guardServiceConfig));

program
  .command('logs')
  .alias('l')
  .description('Show unified logs from all services')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
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
          'pm2',
          'logs',
          ...(lines ? ['--lines', lines] : []),
          ...(stream ? [] : ['--nostream']),
        ],
        { stdio: 'inherit', cwd: projectRoot }
      );
    }
  );

program
  .command('status')
  .description('Show status of all configured services')
  .action(async () => {
    const pm2StatusByProcessName = getPm2StatusByProcessName();
    for (const serviceConfig of serviceConfigsStartOrder) {
      await runServiceStatus(serviceConfig, {
        pm2Status: pm2StatusByProcessName.get(serviceConfig.pm2ProcessName),
      });
      console.log();
    }
  });

program
  .command('start')
  .description('Start all configured services')
  .action(async () => {
    for (const serviceConfig of serviceConfigsStartOrder) {
      const ok = await startServiceAndWaitForIdle(serviceConfig);
      if (!ok) {
        console.error(
          pc.red(`${serviceConfig.label} failed. Stopping startup.`)
        );
        process.exit(1);
      }
    }
  });

program
  .command('stop')
  .description('Stop all configured services')
  .action(() => {
    for (const serviceConfig of allServiceConfigs) {
      runServiceStop(serviceConfig);
    }
  });

program
  .command('restart')
  .description('Restart all configured services')
  .action(async () => {
    for (const serviceConfig of allServiceConfigs) {
      runServiceStop(serviceConfig);
    }
    for (const serviceConfig of serviceConfigsStartOrder) {
      const ok = await startServiceAndWaitForIdle(serviceConfig);
      if (!ok) {
        console.error(
          pc.red(`${serviceConfig.label} failed. Stopping startup.`)
        );
        process.exit(1);
      }
    }
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

        const session = await sdk.Session.existing(sessionId);
        await session.connect();

        let buffer = '';

        session.listen({
          onTurnStart() {
            buffer = '';
          },
          onThinking(chunk) {
            process.stdout.write(pc.gray(chunk));
          },
          onContent(chunk) {
            buffer += chunk;
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
  )
  .addCommand(
    new Command('update')
      .description(
        'Send a prompt to an existing session. Only works if the `DEBUG` env variable is set when starting the agent service.'
      )
      .argument('<sessionId>', 'ID of the session to prompt')
      .argument('<prompt>', 'Prompt text')
      .option(
        '-t, --timeout <number>',
        'Timeout before update is sent in seconds'
      )
      .option(
        '-c, --capture',
        'Whether the CLI should capture the output or leave it to the already registered client'
      )
      .action(
        async (
          sessionId: string,
          promptText: string,
          { timeout: timeoutSeconds = 0 }: { timeout?: number }
        ) => {
          const totalSeconds = Number(timeoutSeconds) || 0;
          const timeoutMs = totalSeconds * 1000;

          const socketPath = path.join(
            projectRoot,
            'service',
            '.cli-socket.sock'
          );

          if (!fs.existsSync(socketPath)) {
            console.error(
              pc.red(
                'Socket file not found. Make sure you started the agent with DEBUG=1'
              )
            );
            process.exit(1);
          }

          const session = await sdk.Session.existing(sessionId);
          await session.connect();

          let buffer = '';

          session.listen('cli', {
            onTurnStart() {
              buffer = '';
            },
            onThinking(chunk) {
              process.stdout.write(pc.gray(chunk));
            },
            onContent(chunk) {
              buffer += chunk;
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

          if (totalSeconds > 0) {
            if (totalSeconds > 2) {
              let remaining = totalSeconds;
              const intervalId = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                  clearInterval(intervalId);
                  return;
                }
                console.log(`${remaining} seconds left`);
              }, 1000);
            }
            setTimeout(async () => {
              await TaskChannel.send(
                'force-update',
                { sessionId, text: promptText },
                socketPath
              );
              process.exit(0);
            }, timeoutMs);
          } else {
            await TaskChannel.send(
              'force-update',
              { sessionId, text: promptText },
              socketPath
            );
            process.exit(0);
          }
        }
      )
  );

program.parse();
