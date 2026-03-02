import { Command } from 'commander';
import {
  Client,
  type SearchParameters,
  type PageObjectResponse,
  isNotionClientError,
  isFullPage,
} from '@notionhq/client';

function getNotionApiKey(): string {
  const key = process.env.NOTION_API_KEY;
  if (!key?.trim()) {
    console.error(
      'NOTION_API_KEY is required. Set it in your environment or .env (e.g. from your Notion integration settings).'
    );
    process.exit(1);
  }
  return key.trim();
}

async function withNotionClient(
  run: (notion: InstanceType<typeof Client>) => Promise<void>
): Promise<void> {
  const notion = new Client({ auth: getNotionApiKey() });
  try {
    await run(notion);
  } catch (err) {
    if (isNotionClientError(err)) {
      console.error('Notion API error:', err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

function pageTitle(page: PageObjectResponse): string {
  if (!page.properties) return '(untitled)';
  for (const prop of Object.values(page.properties)) {
    const value = prop as { type?: string; title?: Array<{ plain_text?: string }> };
    if (value?.type === 'title' && Array.isArray(value.title) && value.title.length > 0) {
      return value.title[0].plain_text ?? '(untitled)';
    }
  }
  return '(untitled)';
}

async function searchPages(
  notion: InstanceType<typeof Client>,
  opts: { query?: string; pageOnly?: boolean; pageSize?: number }
): Promise<void> {
  const params: SearchParameters = {};
  if (opts.query) params.query = opts.query;
  if (opts.pageOnly) params.filter = { property: 'object', value: 'page' };
  if (opts.pageSize != null && Number.isFinite(opts.pageSize)) {
    params.page_size = Math.min(100, Math.max(1, opts.pageSize));
  }

  const data = await notion.search(params);

  for (const item of data.results) {
    if (isFullPage(item)) {
      console.log(`${item.id}\t${pageTitle(item)}`);
    } else if ('object' in item) {
      console.log(`${item.id}\t[${item.object}]`);
    }
  }

  if (data.has_more && data.next_cursor) {
    console.error('(More results available; pagination not yet implemented in this CLI)');
  }
}

async function getPage(
  notion: InstanceType<typeof Client>,
  pageId: string
): Promise<void> {
  const normalizedId = pageId.replace(/-/g, '');
  const page = await notion.pages.retrieve({ page_id: normalizedId });
  console.log(JSON.stringify(page, null, 2));
}

type BlockWithRichText = {
  type: string;
  id: string;
  has_children: boolean;
  [key: string]: unknown;
};

function richTextToPlain(
  richText: Array<{ plain_text?: string }> | undefined
): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text ?? '').join('');
}

function blockToPlain(block: BlockWithRichText): string {
  const content = block[block.type];
  if (!content || typeof content !== 'object') return '';
  const richText = (content as {
    rich_text?: Array<{ plain_text?: string }>;
  }).rich_text;
  return richTextToPlain(richText);
}

function formatBlockAsMarkdown(
  block: BlockWithRichText,
  text: string,
  indent: string
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  switch (block.type) {
    case 'heading_1':
      return `${indent}# ${trimmed}`;
    case 'heading_2':
      return `${indent}## ${trimmed}`;
    case 'heading_3':
      return `${indent}### ${trimmed}`;
    case 'bulleted_list_item':
      return `${indent}- ${trimmed}`;
    case 'numbered_list_item':
      // We do not track the exact index here; Markdown renderers will number automatically.
      return `${indent}1. ${trimmed}`;
    case 'to_do': {
      const checked = (block as { to_do?: { checked?: boolean } }).to_do
        ?.checked;
      return `${indent}- [${checked ? 'x' : ' '}] ${trimmed}`;
    }
    case 'quote':
      return `${indent}> ${trimmed}`;
    default:
      return `${indent}${trimmed}`;
  }
}

type ImageBlockContent = {
  file?: { url: string };
  external?: { url: string };
  caption?: Array<{ plain_text?: string }>;
};

function mimeFromUrl(url: string): string {
  const match = url.match(/\.(png|jpe?g|gif|webp|svg|bmp|tiff?)(\?|$)/i);
  if (!match) return 'image/png';
  const ext = match[1].toLowerCase().replace('jpg', 'jpeg');
  return `image/${ext}`;
}

async function fetchImageAsBase64(
  url: string,
  apiKey: string
): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url, {
      headers:
        url.includes('notion') || url.includes('amazonaws')
          ? { Authorization: `Bearer ${apiKey}` }
          : undefined,
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    const contentType = res.headers.get('content-type');
    const mime =
      contentType?.split(';')[0]?.trim() || mimeFromUrl(url);
    return { base64, mime };
  } catch {
    return null;
  }
}

async function fetchBlockChildren(
  notion: InstanceType<typeof Client>,
  blockId: string
): Promise<BlockWithRichText[]> {
  const normalizedId = blockId.replace(/-/g, '');
  const blocks: BlockWithRichText[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchBlockChildrenPage(notion, normalizedId, cursor);
    blocks.push(...page.blocks);
    cursor = page.nextCursor;
  } while (cursor);
  return blocks;
}

async function fetchBlockChildrenPage(
  notion: InstanceType<typeof Client>,
  blockId: string,
  cursor?: string
): Promise<{
  blocks: BlockWithRichText[];
  nextCursor: string | undefined;
  hasMore: boolean;
}> {
  const resp = await notion.blocks.children.list({
    block_id: blockId,
    start_cursor: cursor,
    page_size: 100,
  });
  const blocks: BlockWithRichText[] = [];
  for (const b of resp.results) {
    if ('type' in b && typeof b.type === 'string') {
      blocks.push(b as BlockWithRichText);
    }
  }
  return {
    blocks,
    nextCursor: resp.next_cursor ?? undefined,
    hasMore: resp.has_more ?? false,
  };
}

type CollectOptions = { requiredTotal?: number };

function shouldStop(lines: string[], opts: CollectOptions): boolean {
  return (
    opts.requiredTotal != null &&
    Number.isFinite(opts.requiredTotal) &&
    lines.length >= opts.requiredTotal
  );
}

async function collectBlocksMarkdown(
  notion: InstanceType<typeof Client>,
  blockId: string,
  indent: string,
  lines: string[],
  apiKey: string,
  opts: CollectOptions = {}
): Promise<boolean> {
  const normalizedId = blockId.replace(/-/g, '');
  let cursor: string | undefined;
  do {
    const page = await fetchBlockChildrenPage(notion, normalizedId, cursor);
    for (const block of page.blocks) {
      if (block.type === 'image') {
        const image = block.image as ImageBlockContent | undefined;
        const url = image?.file?.url ?? image?.external?.url;
        const caption = image?.caption
          ? richTextToPlain(image.caption as Array<{ plain_text?: string }>)
          : '';
        if (url) {
          const result = await fetchImageAsBase64(url, apiKey);
          if (result) {
            const dataUrl = `data:${result.mime};base64,${result.base64}`;
            lines.push(`${indent}![${caption}](${dataUrl})`);
          } else {
            lines.push(`${indent}(image unavailable: ${url})`);
          }
        }
        if (shouldStop(lines, opts)) return true;
        if (block.has_children) {
          const stopped = await collectBlocksMarkdown(
            notion,
            block.id,
            indent + '  ',
            lines,
            apiKey,
            opts
          );
          if (stopped) return true;
        }
        continue;
      }
      const text = blockToPlain(block);
      const line = formatBlockAsMarkdown(block, text, indent);
      if (line) lines.push(line);
      if (shouldStop(lines, opts)) return true;
      if (block.has_children) {
        const stopped = await collectBlocksMarkdown(
          notion,
          block.id,
          indent + '  ',
          lines,
          apiKey,
          opts
        );
        if (stopped) return true;
      }
    }
    if (!page.hasMore) return false;
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return false;
}

type PageContentsOptions = {
  from?: number;
  lines?: number;
};

async function getPageContents(
  notion: InstanceType<typeof Client>,
  pageId: string,
  options: PageContentsOptions = {}
): Promise<void> {
  const normalizedId = pageId.replace(/-/g, '');
  const page = await notion.pages.retrieve({ page_id: normalizedId });
  if (!isFullPage(page)) {
    console.error('Not a full page object');
    return;
  }
  const fromOpt = options.from;
  const linesOpt = options.lines;
  const startIndex =
    typeof fromOpt === 'number' && Number.isFinite(fromOpt)
      ? Math.max(0, Math.floor(fromOpt) - 1) // CLI is 1-based
      : 0;
  const lineCount =
    typeof linesOpt === 'number' && Number.isFinite(linesOpt)
      ? Math.max(0, Math.floor(linesOpt))
      : undefined;
  const requiredTotal =
    lineCount != null ? startIndex + lineCount : undefined;

  const allLines: string[] = [];
  allLines.push(`# ${pageTitle(page)}`, '');
  await collectBlocksMarkdown(notion, page.id, '', allLines, getNotionApiKey(), {
    requiredTotal,
  });

  let slice = allLines;
  if (lineCount != null) {
    slice = allLines.slice(startIndex, startIndex + lineCount);
  } else if (startIndex > 0) {
    slice = allLines.slice(startIndex);
  }

  for (const line of slice) {
    console.log(line);
  }
}

const program = new Command();

program
  .name('notion')
  .description('CLI to fetch Notion pages using the Notion API (requires NOTION_API_KEY).');

program
  .command('search')
  .description('Search pages shared with your integration')
  .option('-q, --query <string>', 'Filter by title')
  .option('--page-only', 'Return only pages (exclude databases)')
  .option('-n, --page-size <number>', 'Max results (1–100)', (v) => parseInt(v, 10), 100)
  .action(async (opts) => {
    await withNotionClient((notion) =>
      searchPages(notion, {
        query: opts.query,
        pageOnly: opts.pageOnly,
        pageSize: opts.pageSize,
      })
    );
  });

program
  .command('get <page-id>')
  .description('Retrieve a single page by ID')
  .action(async (pageId) => {
    await withNotionClient((notion) => getPage(notion, pageId));
  });

program
  .command('contents <page-id>')
  .description(
    'Print page contents as Markdown (blocks and nested children). Lines are 1-based.'
  )
  .option(
    '--from <number>',
    'Optional: start from this 1-based line number of the rendered Markdown'
  )
  .option(
    '--lines <number>',
    'Optional: maximum number of lines to print from the rendered Markdown'
  )
  .action(async (pageId, opts: { from?: string; lines?: string }) => {
    const fromNum =
      opts.from !== undefined && opts.from !== ''
        ? parseInt(opts.from, 10)
        : undefined;
    const linesNum =
      opts.lines !== undefined && opts.lines !== ''
        ? parseInt(opts.lines, 10)
        : undefined;
    await withNotionClient((notion) =>
      getPageContents(notion, pageId, {
        from: Number.isFinite(fromNum) ? fromNum : undefined,
        lines: Number.isFinite(linesNum) ? linesNum : undefined,
      })
    );
  });

program.parse();
