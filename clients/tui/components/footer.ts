import { spawnSync } from 'node:child_process';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import pc from 'picocolors';
import type { Session } from '../../../gateway';

type FooterOptions = {
  width: number;
  sessionId: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  usage: Session['usage'] | null;
};

export function footer({
  width,
  sessionId,
  model,
  thinkingLevel,
  usage,
}: FooterOptions): string[] {
  const currentWorkingDirectory = process.env.PWD ?? process.cwd();
  const currentGitBranch = getCurrentGitBranch();
  const branchSuffix =
    currentGitBranch === undefined ? '' : ` @ ${currentGitBranch}`;
  const fileSystem =
    currentWorkingDirectory.replace(process.env.HOME ?? '', '~') + branchSuffix;
  const agentState = `${sessionId} • ${model} • thinking: ${thinkingLevel}`;
  const usageFooter = formatUsageFooter(usage);

  return [
    renderFooterLine(width, pc.dim(fileSystem), pc.dim(agentState)),
    renderFooterLine(width, usageFooter.left, usageFooter.right),
  ].filter((line): line is string => line !== null);
}

function renderFooterLine(
  width: number,
  left: string | null,
  right: string | null
): string | null {
  if (left === null && right === null) {
    return null;
  }

  if (left === null) {
    if (right === null) {
      return null;
    }
    return truncateToWidth(right, width);
  }

  if (right === null) {
    return truncateToWidth(left, width);
  }

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);

  if (leftWidth + rightWidth + 1 <= width) {
    return `${left}${' '.repeat(width - leftWidth - rightWidth)}${right}`;
  }

  if (rightWidth >= width) {
    return truncateToWidth(right, width);
  }

  const availableLeftWidth = Math.max(0, width - rightWidth - 1);
  const fittedLeft = truncateToWidth(left, availableLeftWidth);
  return `${fittedLeft} ${right}`;
}

function getCurrentGitBranch(): string | undefined {
  const branchResult = spawnSync('git', ['branch', '--show-current'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (branchResult.status !== 0) {
    return undefined;
  }

  const branch = branchResult.stdout.trim();
  return branch === '' ? undefined : branch;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`;
  }

  return String(Math.round(value));
}

function formatUsageFooter(usage: Session['usage'] | null): {
  left: string | null;
  right: string | null;
} {
  if (usage === null) {
    return {
      left: null,
      right: null,
    };
  }

  const usageSummary = [
    `↑${formatCompactNumber(usage.tokens.input)}`,
    `↓${formatCompactNumber(usage.tokens.output)}`,
    `R${formatCompactNumber(usage.tokens.cacheRead)}`,
    `W${formatCompactNumber(usage.tokens.cacheWrite)}`,
    `$${usage.cost.total.toFixed(3)}`,
    `Σ$${usage.cost.session.total.toFixed(3)}`,
  ].join(' ');

  const windowUsage = `${usage.tokens.percentageWindow.toFixed(1)}%/${formatCompactNumber(usage.tokens.window)}`;
  const limitUsage = `${usage.tokens.percentageLimit.toFixed(1)}%/${formatCompactNumber(usage.tokens.limit)}`;

  return {
    left: `${pc.dim(usageSummary)} ${pc.dim('W')}${contextColor(usage.tokens.percentageWindow, windowUsage)} ${pc.dim('C')}${contextColor(usage.tokens.percentageLimit, limitUsage)}`,
    right: null,
  };

  function contextColor(percentage: number, content: string): string {
    return percentage >= 85
      ? pc.red(content)
      : percentage >= 60
        ? pc.yellow(content)
        : pc.dim(content);
  }
}
