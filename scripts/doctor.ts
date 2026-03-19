import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pc from 'picocolors';
import type { Config } from '../config';
import type { SkillMeta } from '../agent/tools/skills';

type CheckResult = {
  failures: string[];
};

const projectRoot = path.join(import.meta.dirname, '..');

async function checkConfig(config: Config): Promise<CheckResult> {
  const { validate } = await import('../config');
  console.log('');
  console.log(pc.bold('Config (.greg.ts)'));
  const success = await validate(config);
  return { failures: success ? [] : ['Config'] };
}

function checkMemory(): CheckResult {
  console.log('');
  console.log(pc.bold('QMD (memory)'));

  const result = spawnSync('bun', ['run', 'qmd', 'status'], {
    stdio: 'pipe',
    cwd: projectRoot,
    encoding: 'utf-8',
  });

  if (result.status === 0) {
    console.log(pc.green('Ready ✓'));
    return { failures: [] };
  }

  const detail = (result.stderr || result.stdout || '').trim();
  console.error(pc.red(`Failed${detail ? ` — ${detail}` : ''}`));
  return { failures: ['QMD'] };
}

function checkTelegram(config: Config): CheckResult {
  console.log('');
  console.log(pc.bold('Telegram'));

  if (!config.clients?.telegram) {
    console.warn(pc.yellow('Telegram client is not configured'));
  }

  if (!config.clients?.telegram?.senderId) {
    console.warn(
      pc.yellow(
        'clients.telegram.senderId not set — `greg tg send` will not work'
      )
    );
  }

  if (!config.clients?.telegram?.senderId) {
    return { failures: [] };
  }

  console.log(pc.green('Telegram config: ✓'));
  return { failures: [] };
}

function checkSkills(skills: SkillMeta[]): CheckResult {
  console.log('');
  console.log(pc.bold('Skills'));

  let checks = 0;

  for (const skill of skills) {
    const relativePath = path.relative(projectRoot, skill.location);

    if (!skill.requires?.length) continue;
    for (const req of skill.requires) {
      checks++;
      const isEnv = req.startsWith('env:');
      const key = isEnv ? req.slice(4) : req;
      if (isEnv) {
        const value = process.env[key];
        if (value === undefined || value === '') {
          console.warn(
            pc.yellow(
              `[${skill.name}] Warning: "${skill.name}" cannot be used — env ${key} is not set (${relativePath})`
            )
          );
        } else {
          console.log(
            pc.green(
              `[${skill.name}] env ${key} ${pc.green('✓')} (${relativePath})`
            )
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
              `[${skill.name}] Warning: "${skill.name}" cannot be used — CLI "${key}" not found (${relativePath})`
            )
          );
        } else {
          console.log(
            pc.green(
              `[${skill.name}] ${key} ${pc.green('✓')} (${relativePath})`
            )
          );
        }
      }
    }
  }

  if (checks === 0) {
    console.log(pc.gray('No skill dependencies to check.'));
  }

  return { failures: [] };
}

export async function doctor(config: Config): Promise<{ success: boolean }> {
  const { discoverSkills } = await import('../agent/tools/skills');
  const { checkVoice } = await import('../voice/doctor');

  const configResult = await checkConfig(config);
  const memoryResult = checkMemory();
  const voiceResult = await checkVoice(config);
  const telegramResult = checkTelegram(config);
  const skillsResult = checkSkills(discoverSkills(config));

  const failures = [
    ...configResult.failures,
    ...memoryResult.failures,
    ...voiceResult.failures,
    ...telegramResult.failures,
    ...skillsResult.failures,
  ];

  console.log('');

  if (failures.length > 0) {
    console.error(pc.red('Doctor found failures: ' + failures.join(', ')));
  } else {
    console.log(pc.green('No critial issues found ✓'));
  }

  return { success: failures.length === 0 };
}
