import { Command } from 'commander';
import { tools } from '../agent/tools';

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const program = new Command();

program
  .name('agent:tools-cli')
  .description('Run agent tools from the CLI. Primarily useful for debugging.');

for (const tool of tools) {
  const props = tool.spec.input_schema.properties ?? {};
  const required = (tool.spec.input_schema.required ?? []) as string[];

  const cmd = program
    .command(tool.spec.name)
    .description(tool.spec.description ?? '');

  for (const [key, prop] of Object.entries(props)) {
    const opt = `--${key.replace(/_/g, '-')}`;
    const desc = (prop as { description?: string }).description ?? '';
    const type = (prop as { type: string }).type;
    const isRequired = required.includes(key);
    if (type === 'number') {
      if (isRequired)
        cmd.requiredOption(`${opt} <number>`, desc, (v) => Number(v));
      else cmd.option(`${opt} <number>`, desc, (v) => Number(v));
    } else if (type === 'boolean') {
      if (isRequired) cmd.requiredOption(opt, desc);
      else cmd.option(opt, desc);
    } else {
      if (isRequired) cmd.requiredOption(`${opt} <value>`, desc);
      else cmd.option(`${opt} <value>`, desc);
    }
  }

  cmd.action(async (opts) => {
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      const value = opts[camelCase(key)];
      if (value !== undefined) args[key] = value;
    }
    const { content } = await tool.handler(args as any);
    console.log(content);
    process.exit(0);
  });
}

program.parse();
