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
  .command('services')
  .description('Use Greg’s custom CLI tools')
  .addCommand(
    new Command('notion')
      .description('Use Greg’s Notion CLI tool')
      .allowUnknownOption(true)
      .action(() => {
        const notionKey = config.tools.notion?.key;
        if (!notionKey) {
          console.error(
            'Notion key is not set in the config file. Run `greg tools notion setup` to set it up.'
          );
          process.exit(1);
        }
        const args = program.args.slice(2);
        spawnSync(
          'bun',
          ['run', 'scripts/services/notion/notion.ts', ...args],
          {
            stdio: 'inherit',
            cwd: projectRoot,
            env: {
              ...process.env,
              NOTION_API_KEY: notionKey,
            },
          }
        );
      })
      .addCommand(
        new Command('setup')
          .description('Setup the Notion CLI tool')
          .action(async () => {
            console.info(
              pc.blue(
                `Go to https://www.notion.so/profile/integrations/internal and create a new integration.`
              )
            );

            const result = await prompts.text({
              message: 'Integration secret',
              placeholder: 'Enter your Notion integration secret',
            });

            if (prompts.isCancel(result)) {
              process.exit(0);
            }

            config.tools.notion = { key: result.toString() };

            fs.writeFileSync(
              path.join(projectRoot, '.greg.ts'),
              JSON.stringify(config, null, 2)
            );

            console.log(pc.green('Notion API key saved to .greg.ts'));

            if (!fs.existsSync(path.join(getWorkspacePath(), 'skills'))) {
              fs.mkdirSync(path.join(getWorkspacePath(), 'skills'), {
                recursive: true,
              });
            }

            fs.copyFileSync(
              path.join(projectRoot, 'scripts', 'tools', 'notion', 'SKILL.md'),
              path.join(getWorkspacePath(), 'skills', 'SKILL.md')
            );
            console.log(pc.green('Copied Notion skill to workspace'));

            console.info(pc.green('Done setting up Notion for Greg.'));

            console.info(
              pc.gray(
                `Make sure to share the pages you want to use with your integration. Run \`greg tools notion search\` to see which pages are available. More information here: https://developers.notion.com/guides/get-started/create-a-notion-integration.`
              )
            );

            process.exit(0);
          })
      )
  )
  .addCommand(
    new Command('strava')
      .description('Use Greg’s Strava CLI tool')
      .allowUnknownOption(true)
      .action(() => {
        const strava = config.tools.strava;
        if (!strava) {
          console.error('Strava is not configured in the config file');
          process.exit(1);
        }

        let tokens = null;

        if (fs.existsSync(path.join(getWorkspacePath(), 'strava.json'))) {
          tokens = JSON.parse(
            fs.readFileSync(
              path.join(getWorkspacePath(), 'strava.json'),
              'utf8'
            )
          );
        }

        const { clientId, clientSecret } = strava;
        const args = program.args.slice(2);

        spawnSync(
          'bun',
          ['run', 'scripts/services/strava/strava.ts', ...args],
          {
            stdio: 'inherit',
            cwd: projectRoot,
            env: {
              ...process.env,
              STRAVA_CLIENT_ID: clientId,
              STRAVA_CLIENT_SECRET: clientSecret,
              STRAVA_ACCESS_TOKEN: tokens?.access_token ?? null,
              STRAVA_REFRESH_TOKEN: tokens?.refresh_token ?? null,
              STRAVA_STORAGE_PATH: path.join(getWorkspacePath(), 'strava.json'),
            },
          }
        );
      })
  );

program.parse();
