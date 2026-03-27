import { Markdown, type MarkdownTheme } from '@mariozechner/pi-tui';
import { highlight, supportsLanguage } from 'cli-highlight';
import pc from 'picocolors';

export const markdownTheme: MarkdownTheme = {
  heading: (text) => pc.bold(pc.blue(text)),
  link: (text) => pc.underline(pc.blue(text)),
  linkUrl: (text) => pc.gray(text),
  code: (text) => pc.black(pc.blue(text)),
  codeBlock: (text) => pc.white(text),
  highlightCode: (code, lang) => {
    const highlightOptions =
      lang !== undefined && supportsLanguage(lang)
        ? { language: lang, ignoreIllegals: true }
        : { ignoreIllegals: true };
    return highlight(code, highlightOptions).split('\n');
  },
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
  paddingX: number;
  paddingY: number;
}): Markdown =>
  new Markdown(
    options.content,
    options.paddingX,
    options.paddingY,
    markdownTheme
  );
