import { Command } from 'commander';
import { get as getConfig } from '../config';
import { get as getTools } from '../agent/tools';
import type { ToolContext } from '../agent/types';

const config = await getConfig();

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

type JsonSchemaProp = Record<string, unknown>;

type ParamsSchema = {
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPropArray(value: unknown): JsonSchemaProp[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: JsonSchemaProp[] = [];
  for (const entry of value) {
    if (isRecord(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

function collectConstValues(prop: JsonSchemaProp): unknown[] | undefined {
  if ('const' in prop) {
    return [prop.const];
  }
  const variants = asPropArray(prop.anyOf) ?? asPropArray(prop.oneOf);
  if (!variants) return undefined;
  const values: unknown[] = [];
  for (const branch of variants) {
    if ('const' in branch) values.push(branch.const);
  }
  return values.length > 0 ? values : undefined;
}

function formatConstForHelp(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (isRecord(value) && typeof value.provider === 'string') {
    const id = value.id;
    if (typeof id === 'string') return `${value.provider}/${id}`;
  }
  const encoded = JSON.stringify(value);
  return encoded.length > 120 ? `${encoded.slice(0, 117)}...` : encoded;
}

function schemaTypeSummary(prop: JsonSchemaProp): string {
  const enumList = prop.enum;
  if (Array.isArray(enumList) && enumList.length > 0) {
    return `enum: ${enumList.map((v) => formatConstForHelp(v)).join(' | ')}`;
  }

  const constValues = collectConstValues(prop);
  if (constValues && constValues.length > 0) {
    if (constValues.every((v) => typeof v === 'string')) {
      return `enum: ${constValues.map((v) => formatConstForHelp(v)).join(' | ')}`;
    }
    return `one of: ${constValues.map((v) => formatConstForHelp(v)).join('; ')}`;
  }

  const propType = typeof prop.type === 'string' ? prop.type : undefined;
  if (propType === 'array') {
    const items = prop.items;
    if (isRecord(items)) {
      const inner = schemaTypeSummary(items);
      return inner ? `array of (${inner})` : 'array';
    }
    return 'array';
  }

  if (propType === 'object' && isRecord(prop.properties)) {
    return `object`;
  }

  if (propType === 'integer') return 'integer';
  if (propType) return propType;

  return '';
}

function effectivePropDescription(prop: JsonSchemaProp): string {
  const top =
    typeof prop.description === 'string' ? prop.description.trim() : '';
  if (top) return top;
  const propType = typeof prop.type === 'string' ? prop.type : undefined;
  if (propType === 'array') {
    const items = prop.items;
    if (isRecord(items) && typeof items.description === 'string') {
      return items.description.trim();
    }
  }
  return '';
}

function helpLineForProp(description: string, prop: JsonSchemaProp): string {
  const summary = schemaTypeSummary(prop);
  const base = description.trim();
  const details: string[] = [];
  if (base) details.push(base);
  if (summary) details.push(summary);

  const propType = inferPropType(prop);
  if (propType === 'array') {
    details.push('accepts comma-separated values or JSON array');
  }

  if (details.length === 0) return '';
  if (details.length === 1) return details[0];
  return `${details[0]} (${details.slice(1).join('; ')})`;
}

function optionPlaceholder(prop: JsonSchemaProp, propType: string): string {
  if (propType === 'number' || propType === 'integer') return 'number';
  if (propType === 'array') return 'json';
  const enumList = prop.enum;
  if (Array.isArray(enumList) && enumList.every((v) => typeof v === 'string')) {
    return 'choice';
  }
  const constValues = collectConstValues(prop);
  if (constValues?.every((v) => typeof v === 'string')) return 'choice';
  if (
    constValues?.some(
      (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    )
  ) {
    return 'json';
  }
  if (propType === 'object') return 'json';
  return 'value';
}

function inferPropType(prop: JsonSchemaProp): string {
  if (typeof prop.type === 'string') return prop.type;
  if (prop.items !== undefined) return 'array';
  if (isRecord(prop.properties)) return 'object';
  return 'string';
}

function coerceCliStringValue(
  value: unknown,
  prop: JsonSchemaProp,
  propType: string
): unknown {
  if (typeof value !== 'string') return value;

  const constValues = collectConstValues(prop);

  if (constValues && constValues.length > 0) {
    const byFormattedValue = constValues.find(
      (constValue) => formatConstForHelp(constValue) === value
    );
    if (byFormattedValue !== undefined) {
      return byFormattedValue;
    }

    const byProviderAndId = constValues.find((constValue) => {
      if (!isRecord(constValue)) return false;
      return (
        typeof constValue.provider === 'string' &&
        typeof constValue.id === 'string' &&
        `${constValue.provider}/${constValue.id}` === value
      );
    });
    if (byProviderAndId !== undefined) {
      return byProviderAndId;
    }
  }

  if (propType === 'array' && value.trimStart().startsWith('[')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  if (propType === 'array') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (optionPlaceholder(prop, propType) === 'json') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

const program = new Command();

program
  .name('tools-cli')
  .description('Run agent tools from the CLI (for debugging and scripting).')
  .option('-l, --list', 'List available tools and exit');

async function main() {
  const toolContext: ToolContext = {
    config,
    onBackgroundUpdate: (...args) =>
      console.log('Background update:', JSON.stringify(args, null, 2)),
  };
  const tools = await getTools(new Date().toISOString(), toolContext);

  if (process.argv.includes('--list') || process.argv.includes('-l')) {
    console.log('Available tools:\n');
    for (const t of tools.tools) {
      console.log(`  ${t.name}`);
      if (t.description) console.log(`    ${t.description}`);
    }
    process.exit(0);
  }

  for (const tool of tools.tools) {
    const schema = tool.parameters as ParamsSchema;
    const props = schema?.properties ?? {};
    const required = schema?.required ?? [];

    const cmd = program.command(tool.name).description(tool.description ?? '');

    for (const [key, prop] of Object.entries(props)) {
      const opt = `--${key.replace(/_/g, '-')}`;
      const desc = helpLineForProp(effectivePropDescription(prop), prop);
      const propType = inferPropType(prop);
      const isRequired = required.includes(key);
      const placeholder = optionPlaceholder(prop, propType);

      if (propType === 'number' || propType === 'integer') {
        if (isRequired) {
          cmd.requiredOption(`${opt} <number>`, desc, (v: string) => Number(v));
        } else {
          cmd.option(`${opt} <number>`, desc, (v: string) => Number(v));
        }
      } else if (propType === 'boolean') {
        if (isRequired) cmd.requiredOption(opt, desc);
        else cmd.option(opt, desc);
      } else {
        const metavar = `<${placeholder}>`;
        if (isRequired) cmd.requiredOption(`${opt} ${metavar}`, desc);
        else cmd.option(`${opt} [${placeholder}]`, desc);
      }
    }

    cmd.action(async (opts: Record<string, unknown>) => {
      const args: Record<string, unknown> = {};

      for (const key of Object.keys(props)) {
        const camelCaseKey = camelCase(key);
        const value =
          opts[camelCaseKey] ??
          opts[key] ??
          opts[key.replace(/_/g, '-')] ??
          opts[key.toLowerCase()];

        if (value !== undefined) {
          const prop = props[key];
          const propType = inferPropType(prop);
          args[key] = coerceCliStringValue(value, prop, propType);
        }
      }

      const signal = new AbortController().signal;

      try {
        const result = await tool.execute('cli', args, signal, () => {});
        console.log(JSON.stringify(result, null, 2));
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
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
