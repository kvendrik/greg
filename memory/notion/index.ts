import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import fs from 'fs';
import { createCollection } from '../qmd';
import collections from './collections.json';

const DATA_PATH = `./memory/.data`;

export async function fetch() {
  for (const collection of Object.keys(collections)) {
    console.info(`Fetching collection ${collection}`);
    const { pages, splitIntoEntries, description } = collections[collection];
    await fetchPages(collection, pages, splitIntoEntries);
    createCollection(collection, description);
  }
}

async function fetchPages(
  collectionName: string,
  pages: Record<string, string>,
  splitIntoEntries: boolean
) {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const n2m = new NotionToMarkdown({ notionClient: notion });

  fs.mkdirSync(`${DATA_PATH}/${collectionName}`, { recursive: true });

  for (const page of Object.keys(pages)) {
    console.info(`Fetching page ${page}`);

    const contents = await fetchPage(pages[page]);
    console.info('...got contents. splitting into entries...');

    if (!splitIntoEntries) {
      const path = `${DATA_PATH}/${collectionName}/${page}.md`;
      fs.writeFileSync(path, contents);
      console.info(`...saved entry to ${path}`);
      continue;
    }

    const entries = contents
      .split('---')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const firstLine = entry.split('\n')[0].replace('# ', '').trim();
      const slug = firstLine
        .replace(/,|!|#/g, '')
        .replace(/\s+|\+|\:/g, '_')
        .toLowerCase();

      const fullSlug = `${page}__${slug}`;
      const path = `${DATA_PATH}/${collectionName}/${fullSlug}.md`;

      fs.writeFileSync(path, entry);
      console.info(`...saved entry to ${path}`);
    }
  }

  async function fetchPage(pageId: string) {
    const mdBlocks = await n2m.pageToMarkdown(pageId);
    const markdown = n2m.toMarkdownString(mdBlocks).parent;
    return markdown;
  }
}
