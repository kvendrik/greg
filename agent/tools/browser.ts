import { MCPClientLike, mcpTools } from '@anthropic-ai/sdk/helpers/beta/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import type { BetaToolResultContentBlockParam } from '@anthropic-ai/sdk/resources/beta';
import { decode } from 'image-js';
import { resize } from 'image-js';
import { encodeJpeg } from 'image-js';

const MAX_TOOL_DESCRIPTION_LENGTH = 400;
const MAX_PROPERTY_DESCRIPTION_LENGTH = 120;
/** Resize screenshot images when base64 exceeds this to stay under prompt limit (200k tokens). */
const MAX_IMAGE_BASE64_CHARS = 80_000;
const SCREENSHOT_MAX_WIDTH = 1024;
const SCREENSHOT_JPEG_QUALITY = 80;

async function resizeImageBase64(
  base64: string,
  _mimeType: string
): Promise<{ data: string; media_type: 'image/jpeg' }> {
  const buffer = Buffer.from(base64, 'base64');
  const image = decode(new Uint8Array(buffer));
  const w = image.width;
  const h = image.height;
  const needResize = w > SCREENSHOT_MAX_WIDTH || h > SCREENSHOT_MAX_WIDTH;
  const resized = needResize
    ? resize(image, {
        width: w > h ? SCREENSHOT_MAX_WIDTH : undefined,
        height: h >= w ? SCREENSHOT_MAX_WIDTH : undefined,
        preserveAspectRatio: true,
      })
    : image;
  const jpeg = encodeJpeg(resized, { quality: SCREENSHOT_JPEG_QUALITY });
  return {
    data: Buffer.from(jpeg).toString('base64'),
    media_type: 'image/jpeg',
  };
}

async function resizeScreenshotResult(
  result: string | BetaToolResultContentBlockParam[]
): Promise<string | BetaToolResultContentBlockParam[]> {
  if (typeof result === 'string') {
    return result;
  }
  const out: BetaToolResultContentBlockParam[] = [];
  let totalChars = 0;
  const maxTextChars = 50_000;
  for (const block of result) {
    if (block.type === 'image') {
      const source = block.source;
      if (
        source &&
        typeof source === 'object' &&
        source.type === 'base64' &&
        typeof source.data === 'string'
      ) {
        if (source.data.length > MAX_IMAGE_BASE64_CHARS) {
          try {
            const { data, media_type } = await resizeImageBase64(
              source.data,
              (source as { media_type?: string }).media_type ?? 'image/png'
            );
            out.push({
              type: 'image',
              source: { type: 'base64', data, media_type },
            });
          } catch {
            out.push({
              type: 'text',
              text: 'Screenshot image could not be resized; it was omitted to fit context limit.',
            });
          }
        } else {
          out.push(block);
        }
      } else {
        out.push(block);
      }
      continue;
    }
    if (block.type === 'text') {
      const text = block.text ?? '';
      if (totalChars + text.length <= maxTextChars) {
        out.push(block);
        totalChars += text.length;
      } else {
        const remaining = maxTextChars - totalChars - 60;
        if (remaining > 0) {
          out.push({
            type: 'text',
            text:
              text.slice(0, remaining) +
              '\n\n[Text truncated to fit context limit.]',
          });
        }
        totalChars = maxTextChars;
      }
      continue;
    }
    out.push(block);
  }
  return out;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

/** Anthropic API does not allow oneOf/allOf/anyOf at top level. Normalize MCP schema to a plain object and trim descriptions to stay under token limits. */
function sanitizeInputSchema(schema: Record<string, unknown>): {
  type: 'object';
  properties: Record<string, unknown> | null;
  required: string[] | null;
} {
  const oneOf = schema.oneOf as unknown[] | undefined;
  const anyOf = schema.anyOf as unknown[] | undefined;
  const allOf = schema.allOf as unknown[] | undefined;
  const variant = oneOf?.[0] ?? anyOf?.[0] ?? allOf?.[0];
  const base =
    variant &&
    typeof variant === 'object' &&
    variant !== null &&
    'type' in variant &&
    (variant as { type: string }).type === 'object'
      ? (variant as Record<string, unknown>)
      : schema;

  const rawProps = (base.properties as Record<string, unknown>) ?? null;
  if (!rawProps || typeof rawProps !== 'object') {
    return {
      type: 'object',
      properties: rawProps,
      required: (base.required as string[]) ?? null,
    };
  }

  const properties: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawProps)) {
    if (val == null || typeof val !== 'object') {
      properties[key] = val;
      continue;
    }
    const prop = val as Record<string, unknown>;
    if (typeof prop.description === 'string') {
      properties[key] = {
        ...prop,
        description: truncate(
          prop.description,
          MAX_PROPERTY_DESCRIPTION_LENGTH
        ),
      };
    } else {
      properties[key] = prop;
    }
  }

  return {
    type: 'object',
    properties: Object.keys(properties).length ? properties : null,
    required: (base.required as string[]) ?? null,
  };
}

export async function get(signal: AbortSignal): Promise<BetaRunnableTool[]> {
  const transport = new StdioClientTransport({
    command: 'uvx',
    args: ['browser-use[cli]', '--mcp'],
    env: { ...process.env, BROWSER_USE_HEADLESS: 'false' },
  });

  const mcp = new Client({ name: 'browser-agent', version: '1.0.0' });
  await mcp.connect(transport);

  signal.addEventListener('abort', () => transport.close(), { once: true });

  const { tools } = await mcp.listTools();

  const runnable = mcpTools(tools, mcp as MCPClientLike);
  return runnable.map((tool) => {
    const t = tool as BetaRunnableTool & {
      input_schema: Record<string, unknown>;
      description?: string;
      name: string;
    };
    const description =
      typeof t.description === 'string'
        ? truncate(t.description, MAX_TOOL_DESCRIPTION_LENGTH)
        : t.description;
    const run =
      t.name === 'browser_screenshot'
        ? async (input: Record<string, unknown>) => {
            const out = await t.run(input);
            return resizeScreenshotResult(
              out as string | BetaToolResultContentBlockParam[]
            );
          }
        : t.run;
    return {
      ...t,
      run,
      ...(description !== undefined ? { description } : {}),
      input_schema: sanitizeInputSchema(t.input_schema),
    };
  });
}

export const instructions = `
## Browser Usage
When in doubt on what to do next, use the \`browser_screenshot\` tool to take a screenshot of the current state of the browser and use it to help you decide what to do next.
`;
