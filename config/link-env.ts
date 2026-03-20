import path from 'node:path';
import fs from 'node:fs/promises';
import type { Config } from './types';
import { get as getConfig } from './index';
import pc from 'picocolors';

export const ENV_LINKS: {
  envKey: string;
  getValue: (config: Config) => string | undefined;
}[] = [
  {
    envKey: 'ANTHROPIC_API_KEY',
    getValue: (config) =>
      config.models.find((model) => model.model.provider === 'anthropic')?.key,
  },
  {
    envKey: 'ELEVENLABS_KEY',
    getValue: (config) => config.voice?.elevenlabs?.key,
  },
  {
    envKey: 'ELEVENLABS_VOICE_ID',
    getValue: (config) => config.voice?.elevenlabs?.voiceId,
  },
];

export async function link(): Promise<void> {
  const config = await getConfig();

  let envFileContent = (await fs.exists(envFilePath()))
    ? await fs.readFile(envFilePath(), 'utf8')
    : '';

  const added = [];

  for (const link of ENV_LINKS) {
    const envKey = link.envKey;
    const configuredValue = link.getValue(config);

    if (process.env[envKey]) {
      continue;
    }

    if (envFileContent.includes(`${envKey}=`)) {
      continue;
    }

    const newLine = `${envKey}=${configuredValue}`;
    added.push(envKey);
    envFileContent += `\n${newLine}`;
  }

  if (envFileContent !== '')
    await fs.writeFile(envFilePath(), envFileContent, 'utf8');

  if (added.length === 0) {
    console.log(
      pc.blue('No keys added. Run \`greg doctor\` to check other dependencies.')
    );
    return;
  }

  console.log(
    pc.green(
      `Linked config -> .env. Added ${added.length} keys. Run \`greg doctor\` to check other dependencies.`
    )
  );
  console.log(pc.dim(added.join(', ')));

  function envFilePath(): string {
    return path.join(import.meta.dirname, '..', '.env');
  }
}
