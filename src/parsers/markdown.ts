import { Lexer, type MarkedToken, type Token } from 'marked';
import { DOMParser } from '@xmldom/xmldom';
import { textOf, type SafeElement, type SafeNode } from './epub/sanitize';
import type { TextChapter } from './txt/chapters';
import type { TocEntry } from './epub/parse';
import { markdownLink } from './markdownLink';
import { enhancedLexer, markdownSlug } from './markdownExtensions';
import { resolvePath } from './epub/xml';

export const MARKDOWN_VERSION = 2;
export type DraftFormat = 'plain' | 'markdown';
export interface MarkdownChapter extends TextChapter {
  nodes: SafeNode[];
  level: number;
}

function decodeEntities(text: string) {
  if (!/&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/i.test(text)) return text;
  const normalized = text.replace(
    /&#(x[\da-f]+|\d+);/gi,
    (raw: string, number: string) => {
      const code =
        number[0]?.toLowerCase() === 'x'
          ? Number.parseInt(number.slice(1), 16)
          : Number(number);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? raw
        : '\ufffd';
    },
  );
  // Escape every source tag before the existing offline entity decoder. Decode
  // the whole text once, without retaining a cache of attacker-supplied names.
  return (
    new DOMParser({ onError: () => {} }).parseFromString(
      `<span>${normalized.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>`,
      'text/html',
    ).documentElement?.textContent ?? text
  );
}

/** Canonical text is exactly the DOM textContent, including code indentation.
 * No generated HTML, styles, URLs for images, or executable source enter nodes. */
export function parseMarkdown(
  source: string,
  version: number = MARKDOWN_VERSION,
  images: ReadonlyMap<string, string> = new Map(),
  imagePath = '',
) {
  if (version !== 1 && version !== 2)
    throw new Error('Markdown 段落结构版本不受支持。');
  if (!source.trim()) throw new Error('没有可阅读的 Markdown 内容。');
  const chapters: MarkdownChapter[] = [];
  const toc: TocEntry[] = [];
  const slugs = new Set<string>();
  const notes = new Map<string, Token[]>();
  const references = new Map<string, number>();
  let visited = 0,
    charStart = 0;
  let chapter = makeChapter('正文', 0);
  function makeChapter(title: string, level: number): MarkdownChapter {
    return {
      index: chapters.length,
      title: title || '正文',
      level,
      paragraphs: [],
      nodes: [],
      charStart,
      charCount: 0,
    };
  }
  function finish() {
    const hasImage = (node: SafeNode): boolean =>
      typeof node !== 'string' &&
      (!!node.imageId || node.children.some(hasImage));
    if (
      !chapter.paragraphs.some((p) => p.trim()) &&
      !chapter.nodes.some(hasImage)
    )
      return;
    chapter.charCount = chapter.paragraphs.reduce(
      (sum, p) => sum + p.length,
      0,
    );
    chapters.push(chapter);
    charStart += chapter.charCount;
  }
  function check(depth: number) {
    if (++visited > 200_000 || depth > 64)
      throw new Error('Markdown 结构过于复杂，请拆分后导入。');
  }
  // This Lexer has no extensions: its output is exclusively built-in MarkedToken.
  function inline(tokens: Token[], depth: number): SafeNode[] {
    const nodes: SafeNode[] = [];
    for (const item of tokens) {
      check(depth);
      if (item.type === 'mdMath') {
        nodes.push({
          tag: 'span',
          math: String(item.math),
          children: [item.raw],
        });
        continue;
      }
      if (item.type === 'mdWiki') {
        const [target = '', alias] = String(item.text).split('|');
        const title = target.trim().replace(/^#/, '');
        nodes.push(
          title && !/[#/\\:]/.test(title)
            ? {
                tag: 'a',
                link: '#' + markdownSlug(title),
                children: [alias?.trim() || title],
              }
            : item.raw,
        );
        continue;
      }
      if (item.type === 'mdNote') {
        const label = String(item.label);
        if (!notes.has(label)) nodes.push(item.raw);
        else {
          if (!references.has(label))
            references.set(label, references.size + 1);
          nodes.push({
            tag: 'sup',
            children: [
              {
                tag: 'a',
                link: '#md-note-' + encodeURIComponent(label),
                children: [`[${references.get(label)}]`],
              },
            ],
          });
        }
        continue;
      }
      const token = item as MarkedToken;
      switch (token.type) {
        case 'strong':
        case 'em':
        case 'del':
          nodes.push({
            tag: token.type,
            children: inline(token.tokens, depth + 1),
          });
          break;
        case 'codespan':
          nodes.push({ tag: 'code', children: [token.text] });
          break;
        case 'br':
          nodes.push({ tag: 'br', children: [] });
          break;
        case 'image': {
          let imageId: string | undefined;
          try {
            imageId =
              version === 2
                ? images.get(resolvePath(imagePath, token.href).path)
                : undefined;
          } catch {
            /* External and invalid image paths stay placeholders. */
          }
          if (imageId) {
            nodes.push({
              tag: 'img',
              imageId,
              alt: decodeEntities(token.text),
              children: [],
            });
            break;
          }
          nodes.push({
            tag: 'span',
            kind: 'image-placeholder',
            children: [
              `[图片：${decodeEntities(token.text) || '无替代文字'}；${version === 1 ? '首版暂不加载' : '未找到本地附件或为外部图片'}]`,
            ],
          });
          break;
        }
        case 'link': {
          const href = markdownLink(
            token.autolink ? token.href : decodeEntities(token.href),
          );
          const children = inline(token.tokens, depth + 1);
          nodes.push(
            href
              ? { tag: 'a', link: href, children }
              : {
                  tag: 'span',
                  children: [...children, `（链接：${token.href}）`],
                },
          );
          break;
        }
        case 'text':
          nodes.push(
            ...(token.tokens
              ? inline(token.tokens, depth + 1)
              : [decodeEntities(token.text).replace(/\n/g, ' ')]),
          );
          break;
        case 'escape':
        case 'html':
          nodes.push(token.text);
          break;
        default:
          nodes.push(token.raw);
          break;
      }
    }
    return nodes;
  }
  function paragraph(
    tag: string,
    children: SafeNode[],
    extra: Partial<SafeElement> = {},
  ): SafeElement {
    const node = {
      tag,
      children,
      ...extra,
      paragraphIndex: chapter.paragraphs.length,
    };
    chapter.paragraphs.push(textOf(node));
    return node;
  }
  function heading(
    token: Extract<MarkedToken, { type: 'heading' }>,
    depth: number,
  ) {
    const children = inline(token.tokens, depth + 1);
    const title = children.map(textOf).join('');
    const base = markdownSlug(title);
    let anchor = base,
      suffix = 0;
    while (slugs.has(anchor)) anchor = `${base}-${++suffix}`;
    slugs.add(anchor);
    if (title.trim())
      toc.push({
        title,
        level: token.depth - 1,
        chapterIndex: chapter.index,
        paragraphIndex: chapter.paragraphs.length,
        anchor,
      });
    return paragraph(`h${token.depth}`, children);
  }
  function blocks(tokens: Token[], depth = 0): SafeNode[] {
    const nodes: SafeNode[] = [];
    for (const item of tokens) {
      check(depth);
      if (item.type === 'mdNoteDefinition') continue;
      if (item.type === 'mdMathBlock') {
        nodes.push(
          paragraph('p', [
            {
              tag: 'span',
              math: String(item.math),
              displayMath: true,
              children: [String(item.text)],
            },
          ]),
        );
        continue;
      }
      const token = item as MarkedToken;
      switch (token.type) {
        case 'space':
        case 'def':
          break;
        case 'heading':
          if (depth === 0) {
            finish();
            const title = inline(token.tokens, depth + 1)
              .map(textOf)
              .join('');
            chapter = makeChapter(title, token.depth - 1);
          }
          nodes.push(heading(token, depth));
          break;
        case 'paragraph':
        case 'text':
          nodes.push(
            paragraph(
              'p',
              token.tokens
                ? inline(token.tokens, depth + 1)
                : [decodeEntities(token.text)],
            ),
          );
          break;
        case 'checkbox':
          nodes.push(
            paragraph('p', [token.checked ? '☑ ' : '☐ '], { kind: 'task' }),
          );
          break;
        case 'code':
          nodes.push(
            paragraph(
              'p',
              [
                {
                  tag: 'code',
                  children: [token.text],
                  ...(version === 2
                    ? {
                        language: token.lang?.split(/\s/)[0]?.toLowerCase(),
                        diagram:
                          token.lang?.toLowerCase() === 'mermaid'
                            ? token.text
                            : undefined,
                      }
                    : {}),
                },
              ],
              {
                preformatted: true,
              },
            ),
          );
          break;
        case 'html':
          nodes.push(paragraph('p', [token.text], { preformatted: true }));
          break;
        case 'hr':
          nodes.push({ tag: 'hr', children: [] });
          break;
        case 'blockquote':
          nodes.push({
            tag: 'blockquote',
            children: blocks(token.tokens, depth + 1),
          });
          break;
        case 'list':
          nodes.push({
            tag: token.ordered ? 'ol' : 'ul',
            start: token.ordered ? Number(token.start) : undefined,
            children: token.items.map((item) => {
              const itemTokens = item.tokens.filter(
                (t) => t.type !== 'checkbox',
              );
              const children = blocks(itemTokens, depth + 1);
              if (item.task) {
                const firstParagraph = (
                  nodes: SafeNode[],
                ): SafeElement | undefined => {
                  for (const node of nodes) {
                    if (typeof node === 'string') continue;
                    if (node.paragraphIndex !== undefined) return node;
                    const found = firstParagraph(node.children);
                    if (found) return found;
                  }
                };
                const first = firstParagraph(children);
                const marker = item.checked ? '☑ ' : '☐ ';
                if (first && first.paragraphIndex !== undefined) {
                  first.children.unshift(marker);
                  chapter.paragraphs[first.paragraphIndex] = textOf(first);
                  first.kind = 'task';
                } else
                  children.unshift(paragraph('p', [marker], { kind: 'task' }));
              }
              return { tag: 'li', children };
            }),
          });
          break;
        case 'table': {
          const headers = token.header.map((cell) =>
            inline(cell.tokens, depth + 1)
              .map(textOf)
              .join(''),
          );
          const rows = token.rows.length ? token.rows : [token.header];
          nodes.push({
            tag: 'div',
            kind: 'table',
            children: rows.map((row) => ({
              tag: 'div',
              kind: 'table-row',
              children: row.map((cell, index) =>
                paragraph(
                  'p',
                  [
                    {
                      tag: 'strong',
                      children: [`${headers[index] || `第 ${index + 1} 列`}：`],
                    },
                    ...inline(cell.tokens, depth + 1),
                  ],
                  { kind: 'table-cell', align: cell.align ?? undefined },
                ),
              ),
            })),
          });
          break;
        }
        default:
          nodes.push(paragraph('p', [token.raw]));
          break;
      }
    }
    // Top-level headings switch chapters; their nodes are attached immediately below.
    return nodes;
  }
  try {
    const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const tokens =
      version === 1
        ? Lexer.lex(normalized, { gfm: true })
        : enhancedLexer().lexer(normalized);
    const collectNotes = (tokens: Token[], depth = 0) => {
      for (const token of tokens) {
        check(depth);
        if (token.type === 'mdNoteDefinition') {
          const label = String(token.label);
          if (notes.has(label)) throw new Error('脚注名称重复，请修改后导入。');
          notes.set(label, token.tokens as Token[]);
        } else if ('tokens' in token && Array.isArray(token.tokens))
          collectNotes(token.tokens, depth + 1);
        if (token.type === 'list')
          for (const item of token.items as { tokens: Token[] }[])
            collectNotes(item.tokens, depth + 1);
      }
    };
    if (version === 2) collectNotes(tokens);
    for (const token of tokens) {
      const nodes = blocks([token]);
      chapter.nodes.push(...nodes);
    }
    if (references.size) {
      finish();
      chapter = makeChapter('注释', 0);
      chapter.nodes.push(paragraph('h2', ['注释']));
      for (const [label, number] of references) {
        toc.push({
          title: `注释 ${number}`,
          level: 0,
          chapterIndex: chapter.index,
          paragraphIndex: chapter.paragraphs.length,
          anchor: 'md-note-' + label,
        });
        chapter.nodes.push(
          paragraph('p', [`[${number}] `]),
          ...blocks(notes.get(label)!, 1),
        );
      }
    }
    finish();
  } catch (cause) {
    if (cause instanceof RangeError)
      throw new Error('Markdown 嵌套过深，请拆分后导入。', { cause });
    throw cause;
  }
  if (!chapters.length) throw new Error('没有可阅读的 Markdown 内容。');
  return {
    chapters,
    toc,
    charCount: charStart,
    title: [
      ...(toc[0]?.title ||
        chapters[0]!.paragraphs.find((p) => p.trim()) ||
        'Markdown 文稿'),
    ]
      .slice(0, 30)
      .join(''),
    markdownVersion: version as 1 | 2,
  };
}
