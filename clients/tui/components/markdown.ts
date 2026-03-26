import { Markdown, type MarkdownTheme } from '@mariozechner/pi-tui';
import pc from 'picocolors';

export const markdownTheme: MarkdownTheme = {
  heading: (text) => pc.bold(pc.cyan(text)),
  link: (text) => pc.underline(pc.blue(text)),
  linkUrl: (text) => pc.gray(text),
  code: (text) => pc.black(pc.bgCyan(text)),
  codeBlock: (text) => pc.white(text),
  codeBlockBorder: (text) => pc.cyan(text),
  quote: (text) => pc.dim(pc.white(text)),
  quoteBorder: (text) => pc.gray(text),
  hr: (text) => pc.gray(text),
  listBullet: (text) => pc.magenta(text),
  bold: (text) => pc.bold(text),
  italic: (text) => pc.italic(text),
  strikethrough: (text) => pc.strikethrough(text),
  underline: (text) => pc.underline(text),
};

export const markdown = (options: {
  content: string;
  width: number;
  paddingX: number;
  paddingY: number;
}): string[] =>
  new Markdown(
    options.content,
    options.paddingX,
    options.paddingY,
    markdownTheme
  ).render(options.width);
