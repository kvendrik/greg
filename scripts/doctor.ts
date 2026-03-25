import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pc from 'picocolors';
import { join } from 'node:path';
import { type Config, get as getConfig } from '../config';
import type { SkillMeta } from '../agent/tools/skills';
import { ENV_LINKS } from '../config/link-env';
import type { AgentConfig } from '../agent/types';

type CheckResult = {
  failures: string[];
};

const projectRoot = path.join(import.meta.dirname, '..');

async function checkConfig(config: Config): Promise<CheckResult> {
  const { validate } = await import('../config');
  console.log('');
  console.log(pc.bold('Config (~/.greg/config.ts)'));
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

  if (!config.telegram) {
    console.warn(pc.yellow('Telegram client is not configured'));
  }

  if (!config.telegram?.senderId) {
    console.warn(
      pc.yellow('telegram.senderId not set — `greg tg send` will not work')
    );
  }

  if (!config.telegram?.senderId) {
    return { failures: [] };
  }

  console.log(pc.green('Telegram config: ✓'));
  return { failures: [] };
}

function checkBrowser(config: Config): CheckResult {
  console.log('');
  console.log(pc.bold('Browser Automation'));

  const browserConfig = config.tools.browser;

  if (!browserConfig) {
    console.warn(
      pc.blue('Optional: Browser automation is not configured (tools.browser)')
    );
    return { failures: [] };
  }

  const uvWhichResult = spawnSync('which', ['uv'], {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: projectRoot,
  });

  if (uvWhichResult.status !== 0) {
    const detail = uvWhichResult.error
      ? uvWhichResult.error.message
      : (uvWhichResult.stderr || uvWhichResult.stdout || '').trim();
    console.error(
      pc.red(
        `  ✗ uv not found on PATH${detail ? ` — ${detail}` : ''}\n` +
          '    Impact: browser automation cannot start (uv run scripts/browser-use.py)'
      )
    );
    return { failures: ['uv'] };
  }

  console.log(pc.green('  ✓ uv'));

  // Smoke-test: ensure the Python environment and dependencies are present.
  // This doesn't require Chrome; it just validates that `browser_use` can be imported.
  const importResult = spawnSync(
    'uv',
    ['run', 'python', '-c', 'import browser_use; print("ok")'],
    {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: projectRoot,
    }
  );

  if (importResult.status === 0) {
    console.log(pc.green('  ✓ browser_use Python deps import'));
    return { failures: [] };
  }

  const detail = (importResult.stderr || importResult.stdout || '')
    .trim()
    .slice(0, 1000);
  console.error(
    pc.red(
      `  ✗ browser_use deps not available via "uv run"\n` +
        (detail ? `    Detail: ${detail}\n` : '') +
        '    Suggested fix: run `uv sync` to install Python deps'
    )
  );

  return { failures: ['browser_use (uv deps)'] };
}

async function checkSkills(skills: SkillMeta[]): Promise<CheckResult> {
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
          const linkAvailable = Boolean(
            ENV_LINKS.find((link) => link.envKey === key)?.getValue(
              await getConfig()
            )
          );

          const suffix = linkAvailable
            ? `(${key} available in your config, run \`greg config link-env\` to add it to ${join(import.meta.dirname, '..', '.env')})`
            : '';

          console.warn(
            pc.yellow(
              `[${skill.name}] Warning: "${skill.name}" cannot be used — env ${key} is not set (${relativePath})`
            )
          );

          if (suffix) console.log(pc.dim(suffix));
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
  const browserResult = checkBrowser(config);
  const skillsResult = await checkSkills(discoverSkills(config as AgentConfig));

  const failures = [
    ...configResult.failures,
    ...memoryResult.failures,
    ...voiceResult.failures,
    ...telegramResult.failures,
    ...browserResult.failures,
    ...skillsResult.failures,
  ];

  console.log('');

  if (failures.length > 0) {
    console.error(pc.red('Doctor found failures: ' + failures.join(', ')));
  } else {
    console.log(pc.green('No critical issues found ✓'));
  }

  return { success: failures.length === 0 };
}
