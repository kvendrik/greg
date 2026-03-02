import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Command } from 'commander';
import { tools } from '../agent/tools';

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

type SchemaProp = { type?: string; description?: string };
type ParamsSchema = {
  properties?: Record<string, SchemaProp>;
  required?: string[];
};

const program = new Command();

program
  .name('tools-cli')
  .description('Run agent tools from the CLI (for debugging and scripting).')
  .option('-l, --list', 'List available tools and exit');

function main() {
  if (process.argv.includes('--list') || process.argv.includes('-l')) {
    console.log('Available tools:\n');
    for (const t of tools) {
      console.log(`  ${t.name}`);
      if (t.description) console.log(`    ${t.description}`);
    }
    process.exit(0);
  }

  for (const tool of tools) {
    const schema = (tool as AgentTool).parameters as ParamsSchema;
    const props = schema?.properties ?? {};
    const required = schema?.required ?? [];

    const cmd = program.command(tool.name).description(tool.description ?? '');

    for (const [key, prop] of Object.entries(props)) {
      const opt = `--${key.replace(/_/g, '-')}`;
      const desc = prop?.description ?? '';
      const propType = prop?.type ?? 'string';
      const isRequired = required.includes(key);
      if (propType === 'number') {
        if (isRequired)
          cmd.requiredOption(`${opt} <number>`, desc, (v: string) => Number(v));
        else cmd.option(`${opt} <number>`, desc, (v: string) => Number(v));
      } else if (propType === 'boolean') {
        if (isRequired) cmd.requiredOption(opt, desc);
        else cmd.option(opt, desc);
      } else {
        if (isRequired) cmd.requiredOption(`${opt} <value>`, desc);
        else cmd.option(`${opt} [value]`, desc);
      }
    }

    cmd.action(async (opts: Record<string, unknown>) => {
      const args: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        const value = opts[camelCase(key)];
        if (value !== undefined) args[key] = value;
      }
      const signal = new AbortController().signal;
      try {
        const result = await tool.execute('cli', args, signal, () => {});
        const text =
          result.content?.find(
            (c): c is { type: 'text'; text: string } => c.type === 'text'
          )?.text ?? JSON.stringify(result);
        console.log(text);
        process.exit(0);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  program.parse();
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
