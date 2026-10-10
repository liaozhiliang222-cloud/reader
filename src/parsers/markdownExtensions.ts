import { Marked, type TokenizerExtension } from 'marked';

export const markdownSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
    .replace(/\s/g, '-') || 'section';

/** Extensions tokenize only where Marked permits block/inline tokens, never
 * inside fenced code, code spans, HTML, or escaped Markdown characters. */
export function enhancedLexer() {
  const extensions: TokenizerExtension[] = [
    {
      name: 'mdMathBlock',
      level: 'block',
      start: (src) => src.search(/\$\$|\\\[/),
      tokenizer(src) {
        const match = /^(?:\$\$([^]*?)\$\$|\\\[([^]*?)\\\])(?:[ \t]*\n|$)/.exec(
          src,
        );
        if (match && (match[1] ?? match[2])!.trim())
          return {
            type: 'mdMathBlock',
            raw: match[0],
            text: match[0].trimEnd(),
            math: match[1] ?? match[2],
          };
      },
    },
    {
      name: 'mdMath',
      level: 'inline',
      start: (src) => src.search(/\$|\\\(/),
      tokenizer(src) {
        const match =
          /^(?:\$(?![\s$])((?:\\.|[^$\n])+?)(?<!\s)\$(?!\d)|\\\(([^\n]*?)\\\))/.exec(
            src,
          );
        if (match && (match[1] ?? match[2])!.trim())
          return { type: 'mdMath', raw: match[0], math: match[1] ?? match[2] };
      },
    },
    {
      name: 'mdWiki',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenizer(src) {
        const match = /^\[\[([^\]\n]+)\]\]/.exec(src);
        if (match) return { type: 'mdWiki', raw: match[0], text: match[1] };
      },
    },
    {
      name: 'mdNote',
      level: 'inline',
      start: (src) => src.indexOf('[^'),
      tokenizer(src) {
        const match = /^\[\^([^\]\s]+)\]/.exec(src);
        if (match) return { type: 'mdNote', raw: match[0], label: match[1] };
      },
    },
    {
      name: 'mdNoteDefinition',
      level: 'block',
      start: (src) => src.search(/^\[\^[^\]\s]+\]:/m),
      tokenizer(src) {
        const match =
          /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*)(?:\n|$)/.exec(
            src,
          );
        if (match) {
          const text = match[2]!.replace(/\n(?: {4}|\t)/g, '\n');
          return {
            type: 'mdNoteDefinition',
            raw: match[0],
            label: match[1],
            tokens: this.lexer.blockTokens(text),
          };
        }
      },
    },
  ];
  return new Marked({ gfm: true }, { extensions });
}
