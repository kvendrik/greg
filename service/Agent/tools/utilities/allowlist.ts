import type { AgentConfig, AllowList, AllowListEntry } from '../../types';
import { getWorkspacePath } from '../../utilities';
import path from 'node:path';
import fs from 'node:fs';

export function getAllowlistForCommand(
  /**
   * The command to get the allowlist for.
   * This is a full command string, including arguments.
   * For example: "git pull" or "npm install" or "rm -rf ./tmp/new-file.log".
   */
  command: string,
  config: AgentConfig
): AllowListEntry {
  const workspaceAllowlist = path.join(
    getWorkspacePath(config),
    'exec_allowlist.json'
  );

  if (fs.existsSync(workspaceAllowlist)) {
    const workspaceAllowlistData: AllowList = JSON.parse(
      fs.readFileSync(workspaceAllowlist, 'utf8')
    );

    const configByFull = workspaceAllowlistData?.[command];
    if (configByFull) return configByFull;
    const configByCmd = workspaceAllowlistData?.[command];
    if (configByCmd) return configByCmd;
  }

  const execAllowlist = config.tools.guard?.allowlist?.exec;

  const configByFull = execAllowlist?.[command];
  if (configByFull) return configByFull;
  const configByCmd = execAllowlist?.[command];
  if (configByCmd) return configByCmd;

  return { trusted: false, allow: false };
}

export function saveAlwaysAllowPreferenceForCommand(
  command: string,
  config: AgentConfig
): void {
  const workspaceAllowlist = path.join(
    getWorkspacePath(config),
    'exec_allowlist.json'
  );
  const workspaceAllowlistData: AllowList = fs.existsSync(workspaceAllowlist)
    ? (JSON.parse(fs.readFileSync(workspaceAllowlist, 'utf8')) as AllowList)
    : {};

  workspaceAllowlistData[command] = workspaceAllowlistData[command]
    ? { ...workspaceAllowlistData[command], allow: true }
    : { trusted: false, allow: true };

  fs.writeFileSync(
    workspaceAllowlist,
    JSON.stringify(workspaceAllowlistData, null, 2)
  );
}
