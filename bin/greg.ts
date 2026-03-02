#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { Command } from 'commander';
import { name, description, version, scripts } from '../package.json';
import { getWorkspacePath } from '../agent/utilities';
import fs from 'node:fs';
import config from '../.greg';
import { validate } from '../config';
import * as prompts from '@clack/prompts';
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

program.name(name).description(description).version(version);

program
  .command('setup')
  .description('Setup Greg for the first time')
  .action(() => {
    const proc = spawn('bun', ['run', 'setup'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('start')
  .description('Start the server')
  .action(() => {
    const proc = spawn('bun', ['run', 'agent'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('index')
  .description(
    'Index the memory. Run after you’ve changed Markdown files in the workspace.'
  )
  .action(() => {
    const proc = spawn('bun', ['run', 'agent:memory:index'], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

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

program.command('config').addCommand(
  new Command('validate').description('Validate the config file').action(() => {
    validate(config);
    console.info('Config is valid');
    process.exit(0);
  })
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
    const args = program.args.slice(2);
    const proc = spawn('bun', ['run', 'scripts/jobs', ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

program.parse();
