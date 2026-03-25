import { which } from 'bun';
import { AgentConfig } from '../../..';
import { getRoots } from '../../files/filesystem';

/**
 * Bun/JS runtimes read many hw.* / kern.* sysctls during startup (memory layout, CPU
 * features). Without these `(allow sysctl-read …)` entries, Seatbelt blocks those reads
 * and the process often exits immediately (e.g. 133) with no stderr.
 *
 * List aligned with OpenAI Codex CLI’s macOS seatbelt policy (Chromium common.sb–style).
 */
const SEATBELT_SYSCTL_READ_NAMES = [
  'hw.activecpu',
  'hw.busfrequency_compat',
  'hw.byteorder',
  'hw.cacheconfig',
  'hw.cachelinesize_compat',
  'hw.cpufamily',
  'hw.cpufrequency_compat',
  'hw.cputype',
  'hw.l1dcachesize_compat',
  'hw.l1icachesize_compat',
  'hw.l2cachesize_compat',
  'hw.l3cachesize_compat',
  'hw.logicalcpu_max',
  'hw.machine',
  'hw.ncpu',
  'hw.nperflevels',
  'hw.optional.arm.FEAT_BF16',
  'hw.optional.arm.FEAT_DotProd',
  'hw.optional.arm.FEAT_FCMA',
  'hw.optional.arm.FEAT_FHM',
  'hw.optional.arm.FEAT_FP16',
  'hw.optional.arm.FEAT_I8MM',
  'hw.optional.arm.FEAT_JSCVT',
  'hw.optional.arm.FEAT_LSE',
  'hw.optional.arm.FEAT_RDM',
  'hw.optional.arm.FEAT_SHA512',
  'hw.optional.armv8_2_sha512',
  'hw.memsize',
  'hw.pagesize',
  'hw.packages',
  'hw.pagesize_compat',
  'hw.physicalcpu_max',
  'hw.tbfrequency_compat',
  'hw.vectorunit',
  'kern.hostname',
  'kern.maxfilesperproc',
  'kern.osproductversion',
  'kern.osrelease',
  'kern.ostype',
  'kern.osvariant_status',
  'kern.osversion',
  'kern.secure_kernel',
  'kern.usrstack64',
  'kern.version',
  'sysctl.proc_cputype',
] as const;

function seatbeltSysctlReadAllow(): string {
  const sysctlLines = SEATBELT_SYSCTL_READ_NAMES.map(
    (name) => ` (sysctl-name "${name}")`
  ).join('\n');
  return `(allow sysctl-read\n${sysctlLines}\n (sysctl-name-prefix "hw.perflevel"))`;
}

export function sandbox(
  params: { command: string; args: string[] },
  config: AgentConfig
): {
  command: string;
  args: string[];
} {
  const profile = createProfile(config);
  const bin = which('sandbox-exec');

  if (!bin) {
    throw new Error('sandbox-exec not found');
  }

  return {
    command: bin,
    args: ['-p', profile, params.command, ...params.args],
  };
}

function seatbeltDenySubpaths(roots: string[]): string {
  return roots
    .map((root) => {
      const path = root.startsWith('!') ? root.slice(1) : root;
      return `(subpath "${path}")`;
    })
    .join(' ');
}

function createProfile(config: AgentConfig): string {
  const readDeny = seatbeltDenySubpaths(getRoots('read', config).deny);

  const writeAllow = getRoots('write', config)
    .allow.map((root) => `(subpath "${root}")`)
    .join(' ');

  const writeDeny = seatbeltDenySubpaths(getRoots('write', config).deny);

  // Exec’d processes must read system binaries, dylibs, certs, etc. Keep secrecy
  // paths blocked via tools.guard.files read deny (`!…` entries).
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow network*)',
    '(allow file-read-metadata)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target self))',
    '(allow file-read*)',
    seatbeltSysctlReadAllow(),
  ];
  if (readDeny.length > 0) {
    lines.push(`(deny file-read* ${readDeny})`);
  }
  lines.push(`(allow file-write* ${writeAllow})`);
  if (writeDeny.length > 0) {
    lines.push(`(deny file-write* ${writeDeny})`);
  }
  return lines.join('\n');
}
