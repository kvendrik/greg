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
    const value = prop as {
      type?: string;
      title?: { plain_text?: string }[];
    };
    if (
      value?.type === 'title' &&
      Array.isArray(value.title) &&
      value.title.length > 0
    ) {
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
    console.error(
      '(More results available; pagination not yet implemented in this CLI)'
    );
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

/** All block types returned by the Notion API (see developers.notion.com/reference/block). */
const NOTION_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'quote',
  'callout',
  'toggle',
  'code',
  'template',
  'table_row',
  'table_of_contents',
  'table',
  'synced_block',
  'divider',
  'child_page',
  'child_database',
  'image',
  'video',
  'file',
  'pdf',
  'bookmark',
  'embed',
  'link_preview',
  'equation',
  'column_list',
  'column',
  'breadcrumb',
  'transcription',
  'audio',
  'unsupported',
] as const;

type NotionBlockType = (typeof NOTION_BLOCK_TYPES)[number];

type BlockWithRichText = {
  type: string;
  id: string;
  has_children: boolean;
  [key: string]: unknown;
};

function richTextToPlain(
  richText: { plain_text?: string }[] | undefined
): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text ?? '').join('');
}

function getBlockContent(block: BlockWithRichText): string {
  const content = block[block.type];
  if (!content || typeof content !== 'object') return '';
  const obj = content as Record<string, unknown>;
  const richText = obj.rich_text as { plain_text?: string }[] | undefined;
  if (Array.isArray(richText)) return richTextToPlain(richText);
  if (typeof obj.title === 'string') return obj.title;
  const titleArr = obj.title as { plain_text?: string }[] | undefined;
  if (Array.isArray(titleArr)) return richTextToPlain(titleArr);
  if (typeof obj.expression === 'string') return obj.expression;
  if (Array.isArray(obj.cells)) {
    return (obj.cells as { plain_text?: string }[][])
      .map((cell) => richTextToPlain(cell))
      .join(' | ');
  }
  return '';
}

function formatBlockAsMarkdown(
  block: BlockWithRichText,
  text: string,
  indent: string
): string | null {
  const trimmed = text.trim();
  if (!trimmed && block.type !== 'divider') return null;

  const type = block.type as NotionBlockType;
  switch (type) {
    case 'heading_1':
      return `${indent}# ${trimmed}`;
    case 'heading_2':
      return `${indent}## ${trimmed}`;
    case 'heading_3':
      return `${indent}### ${trimmed}`;
    case 'bulleted_list_item':
      return `${indent}- ${trimmed}`;
    case 'numbered_list_item':
      return `${indent}1. ${trimmed}`;
    case 'to_do': {
      const checked = (block as { to_do?: { checked?: boolean } }).to_do
        ?.checked;
      return `${indent}- [${checked ? 'x' : ' '}] ${trimmed}`;
    }
    case 'quote':
      return `${indent}> ${trimmed}`;
    case 'callout':
      return `${indent}> ${trimmed}`;
    case 'toggle':
      return `${indent}- ${trimmed}`;
    case 'code': {
      const lang =
        (block.code as { language?: string } | undefined)?.language ?? '';
      return `${indent}\`\`\`${lang}\n${trimmed}\n${indent}\`\`\``;
    }
    case 'paragraph':
    case 'template':
    case 'transcription':
      return `${indent}${trimmed}`;
    case 'table_row':
      return `${indent}| ${trimmed} |`;
    case 'divider':
      return `${indent}---`;
    case 'child_page':
    case 'child_database':
      return `${indent}**${trimmed}**`;
    case 'equation':
      return `${indent}$$${trimmed}$$`;
    case 'table_of_contents':
    case 'breadcrumb':
      return null;
    case 'unsupported':
      return null;
    default:
      return `${indent}${trimmed}`;
  }
}

type MediaBlockContent = {
  file?: { url: string };
  external?: { url: string };
  caption?: { plain_text?: string }[];
  url?: string;
  name?: string;
};

function getMediaUrlAndCaption(block: BlockWithRichText): {
  url: string | null;
  caption: string;
} {
  const content = block[block.type] as MediaBlockContent | undefined;
  if (!content || typeof content !== 'object')
    return { url: null, caption: '' };
  const url =
    content.url ??
    content.file?.url ??
    (content as { external?: { url?: string } }).external?.url ??
    null;
  const caption = content.caption
    ? richTextToPlain(content.caption as { plain_text?: string }[])
    : (content.name ?? '');
  return { url, caption: String(caption).trim() };
}

function mimeFromUrl(url: string): string {
  const match = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?)(\?|$)/i.exec(url);
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
    const mime = contentType?.split(';')[0]?.trim() || mimeFromUrl(url);
    return { base64, mime };
  } catch {
    return null;
  }
}

async function _fetchBlockChildren(
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

const STRUCTURAL_BLOCK_TYPES: readonly NotionBlockType[] = [
  'column_list',
  'column',
  'table',
  'synced_block',
];

function isStructuralBlock(type: string): type is NotionBlockType {
  return STRUCTURAL_BLOCK_TYPES.includes(type as NotionBlockType);
}

/** Media blocks that are rendered as markdown links (image is handled separately with base64). */
const MEDIA_LINK_BLOCK_TYPES: readonly NotionBlockType[] = [
  'video',
  'file',
  'pdf',
  'bookmark',
  'embed',
  'link_preview',
  'audio',
];

function isMediaLinkBlock(type: string): type is NotionBlockType {
  return MEDIA_LINK_BLOCK_TYPES.includes(type as NotionBlockType);
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
      const blockType = block.type as NotionBlockType;

      if (blockType === 'image') {
        const image = block.image as MediaBlockContent | undefined;
        const url = image?.file?.url ?? image?.external?.url;
        const caption = image?.caption
          ? richTextToPlain(image.caption as { plain_text?: string }[])
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

      if (isMediaLinkBlock(blockType)) {
        const { url, caption } = getMediaUrlAndCaption(block);
        if (url) {
          const label = caption || url;
          lines.push(`${indent}[${label}](${url})`);
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

      if (isStructuralBlock(blockType)) {
        const stopped = await collectBlocksMarkdown(
          notion,
          block.id,
          indent,
          lines,
          apiKey,
          opts
        );
        if (stopped) return true;
        continue;
      }

      const text = getBlockContent(block);
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

      if (!NOTION_BLOCK_TYPES.includes(blockType)) {
        console.error(`Unknown Notion block type: ${block.type}`);
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
  const requiredTotal = lineCount != null ? startIndex + lineCount : undefined;

  const allLines: string[] = [];
  allLines.push(`# ${pageTitle(page)}`, '');
  await collectBlocksMarkdown(
    notion,
    page.id,
    '',
    allLines,
    getNotionApiKey(),
    {
      requiredTotal,
    }
  );

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
  .description(
    'CLI to fetch Notion pages using the Notion API (requires NOTION_API_KEY).'
  );

program
  .command('search')
  .description('Search pages shared with your integration')
  .option('-q, --query <string>', 'Filter by title')
  .option('--page-only', 'Return only pages (exclude databases)')
  .option(
    '-n, --page-size <number>',
    'Max results (1–100)',
    (v) => parseInt(v, 10),
    100
  )
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

export const notionCommand = program;

if (import.meta.main) {
  program.parse(process.argv);
}
