import { Command } from 'commander';
import { get } from '../agent/tools';
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

type SchemaProp = { type: string; description?: string };

const program = new Command();

program
  .name('tools-cli')
  .description('Run agent tools from the CLI (for debugging and scripting).')
  .option('-l, --list', 'List available tools and exit');

async function main() {
  const tools = (await get(new AbortController().signal)) as BetaTool[];

  if (process.argv.includes('--list') || process.argv.includes('-l')) {
    console.log('Available tools:\n');
    for (const t of tools) {
      console.log(`  ${t.name}`);
      if (t.description) console.log(`    ${t.description}`);
    }
    process.exit(0);
  }

  for (const tool of tools) {
    const schema = tool.input_schema;
    const props = (schema?.properties ?? {}) as Record<string, SchemaProp>;
    const required = (schema?.required ?? []) as string[];

    const cmd = program.command(tool.name).description(tool.description ?? '');

    for (const [key, prop] of Object.entries(props)) {
      const opt = `--${key.replace(/_/g, '-')}`;
      const desc = prop?.description ?? '';
      const type = prop?.type ?? 'string';
      const isRequired = required.includes(key);
      if (type === 'number') {
        if (isRequired)
          cmd.requiredOption(`${opt} <number>`, desc, (v: string) => Number(v));
        else cmd.option(`${opt} <number>`, desc, (v: string) => Number(v));
      } else if (type === 'boolean') {
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
      try {
        const parsed = (tool as BetaRunnableTool).parse
          ? (tool as BetaRunnableTool).parse(args)
          : args;
        const result = await (tool as BetaRunnableTool).run(parsed);
        console.log(result);
        process.exit(0);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  program.parse();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
