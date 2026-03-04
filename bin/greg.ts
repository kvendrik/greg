#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { Command } from 'commander';
import { name, description, version, scripts } from '../package.json';
import config from '../.greg';
import { validate } from '../config';
import pc from 'picocolors';

if (!scripts.agent) {
  throw new Error('Something is wrong. Agent script not found in package.json');
}

if (!scripts['agent:memory:index']) {
  throw new Error(
    'Something is wrong. Memory indexing script not found in package.json'
  );
}

if (!scripts['clients:cli']) {
  throw new Error('Something is wrong. CLI script not found in package.json');
}

if (!scripts['clients:telegram']) {
  throw new Error(
    'Something is wrong. Telegram script not found in package.json'
  );
}

const projectRoot = path.join(import.meta.dirname, '..');
const program = new Command();

program
  .name(name)
  .description(
    `${description}.\nSee ${path.resolve('./README.md')} for details.`
  )
  .version(version);

program
  .command('start')
  .description('Starts Greg')
  .option('-a, --attach', 'Run using attach to immediately see the logs')
  .action(({ attach }: { attach: boolean }) => {
    const statusResult = spawnSync('bun', ['run', 'pm2', 'describe', 'greg'], {
      stdio: 'pipe',
      cwd: projectRoot,
    });

    const gregStarted = statusResult.status === 0;

    if (gregStarted) {
      console.log(
        pc.green('Greg is already running. Run `greg logs` to see the logs.')
      );
      process.exit(0);
    }

    const startResult = spawnSync('bun', ['run', 'agent'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });

    if (attach && startResult.status === 0) {
      spawnSync('bun', ['run', 'agent:logs'], {
        stdio: 'inherit',
        cwd: projectRoot,
      });
    }
  });

program
  .command('status')
  .description("Gets Greg's status")
  .option('-v, --verbose', 'Show verbose output')
  .action(({ verbose }: { verbose: boolean }) => {
    const proc = spawn('bun', ['run', 'pm2', 'describe', 'greg'], {
      stdio: 'pipe',
      cwd: projectRoot,
    });
    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(pc.green('🤖 Greg is running.'));
        console.log(
          pc.gray(
            'Run `greg logs` to see the logs.\nRun `greg status` again with flag `-v` to see the verbose output.'
          )
        );
        if (verbose) {
          console.log(stdout);
        }
      } else {
        console.log('Greg is not running. Run `greg start` to start.');
      }
      process.exit(code ?? 0);
    });
  });

program
  .command('stop')
  .description('Stops Greg')
  .action(() => {
    spawn('bun', ['run', 'agent:stop'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
  });

program
  .command('restart')
  .description('Restarts Greg')
  .action(() => {
    spawn('bun', ['run', 'agent:restart'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
  });

program
  .command('logs')
  .description("Shows Greg's logs")
  .action(() => {
    spawn('bun', ['run', 'agent:logs'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
  });

program
  .command('memory')
  .description('Manage Greg’s memory')
  .addCommand(
    new Command('index')
      .description(
        'Index the memory. Run after you’ve changed Markdown files in the workspace.'
      )
      .action(() => {
        const proc = spawn('bun', ['run', 'agent:memory:index'], {
          stdio: 'inherit',
          cwd: projectRoot,
        });
        proc.on('exit', (code) => process.exit(code ?? 0));
      })
  );

program
  .command('cli')
  .description('Chat with Greg in the terminal')
  .argument('[prompt]', 'initial prompt to pass to Greg', '')
  .action((prompt: string) => {
    const proc = spawn('bun', ['run', 'clients:cli', prompt], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('telegram')
  .description('Talk to Greg via Telegram')
  .action(() => {
    const proc = spawn('bun', ['run', 'clients:telegram'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('config')
  .description('Manage Greg’s config')
  .addCommand(
    new Command('validate')
      .description('Validate the config file')
      .action(async () => {
        await validate(config);
      })
  )
  .addCommand(
    new Command('path')
      .description('Get the current config path')
      .action(() => console.log(path.resolve('./.greg.ts')))
  );

program
  .command('tools')
  .description('Use Greg’s tools directly from the command line')
  .allowUnknownOption()
  .action(() => {
    const args = program.args.slice(2);
    const proc = spawn('bun', ['run', 'agent:tools', ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('jobs')
  .description('Manage scheduled jobs')
  .action(() => {
    const args = program.args.slice(1);
    const proc = spawn('bun', ['run', 'scripts/jobs', ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program.parse();
