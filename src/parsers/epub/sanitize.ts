import {
  elements,
  localName,
  parseXml,
  resolvePath,
  type XmlElement,
} from './xml';
import { sanitizeModernChapter } from './normalize';
import { EPUB_PARSER_VERSION, type EpubParserVersion } from './version';

export interface SafeElement {
  tag: string;
  children: SafeNode[];
  paragraphIndex?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  imageId?: string;
  alt?: string;
  preformatted?: boolean;
  link?: string;
  start?: number;
  math?: string;
  displayMath?: boolean;
  diagram?: string;
  language?: string;
  kind?: 'table' | 'table-row' | 'table-cell' | 'image-placeholder' | 'task';
}
export type SafeNode = string | SafeElement;
const allowed = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'em',
  'strong',
  'b',
  'i',
  'img',
  'br',
  'blockquote',
  'ul',
  'ol',
  'li',
  'sup',
  'sub',
  'ruby',
  'rt',
  'hr',
  'span',
]);
const dropped = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'link',
  'meta',
  'svg',
  'math',
  'audio',
  'video',
  'source',
  'noscript',
  'template',
]);
const blocks = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'li',
]);
export const textOf = (node: SafeNode): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

export function sanitizeChapter(
  source: string,
  path: string,
  images: ReadonlyMap<string, string>,
  version: EpubParserVersion = EPUB_PARSER_VERSION,
  svg?: (element: XmlElement) => SafeNode[],
) {
  if (version !== 1)
    return sanitizeModernChapter(
      source,
      path,
      images,
      version === 3 ? svg : undefined,
    );
  const doc = parseXml(source);
  const body = elements(doc, 'body')[0] ?? doc.documentElement;
  if (!body) throw new Error('章节正文不存在。');
  const paragraphs: string[] = [];
  const anchors: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  const ids = new Map<SafeElement, string[]>();
  const hasParagraph = (node: SafeNode): boolean =>
    typeof node !== 'string' &&
    (node.paragraphIndex !== undefined || node.children.some(hasParagraph));
  const clean = (el: XmlElement): SafeNode[] => {
    const tag = localName(el);
    if (dropped.has(tag)) return [];
    if (tag === 'img') {
      let imageId: string | undefined;
      try {
        imageId = images.get(
          resolvePath(path, el.getAttribute('src') ?? '').path,
        );
      } catch {
        /* 外链直接丢弃 */
      }
      return imageId
        ? [
            {
              tag: 'img',
              children: [],
              imageId,
              alt: el.getAttribute('alt') ?? '',
            },
          ]
        : [];
    }
    const content = Array.from(el.childNodes).flatMap((node) => {
      if (node.nodeType === 3 || node.nodeType === 4)
        return [node.nodeValue ?? ''];
      return node.nodeType === 1 ? clean(node as XmlElement) : [];
    });
    if (!allowed.has(tag)) return content;
    const result: SafeElement = { tag, children: content };
    const align =
      el.getAttribute('align') ||
      /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i.exec(
        el.getAttribute('style') ?? '',
      )?.[1];
    if (align && ['left', 'center', 'right', 'justify'].includes(align))
      result.align = align as SafeElement['align'];
    if (blocks.has(tag) && !content.some(hasParagraph)) {
      result.paragraphIndex = -1;
      ids.set(
        result,
        [el, ...Array.from(el.getElementsByTagName('*'))]
          .map((n) => n.getAttribute('id'))
          .filter((id): id is string => Boolean(id)),
      );
    }
    return [result];
  };
  const nodes: SafeNode[] = [];
  // 散落在 body/div 下的行内内容也构成可定位段落。
  let inline: SafeNode[] = [];
  const flush = () => {
    if (!inline.length) return;
    if (
      inline.some((n) => typeof n !== 'string') ||
      inline.map(textOf).join('').trim()
    ) {
      const paragraph: SafeElement = {
        tag: 'p',
        children: inline,
        paragraphIndex: -1,
      };
      nodes.push(paragraph);
    }
    inline = [];
  };
  for (const node of clean(body)) {
    if (hasParagraph(node)) {
      flush();
      nodes.push(node);
    } else inline.push(node);
  }
  flush();
  const indexNode = (node: SafeNode) => {
    if (typeof node === 'string') return;
    if (node.paragraphIndex !== undefined) {
      node.paragraphIndex = paragraphs.length;
      paragraphs.push(textOf(node));
      for (const id of ids.get(node) ?? []) anchors[id] = node.paragraphIndex;
    } else node.children.forEach(indexNode);
  };
  nodes.forEach(indexNode);
  return { nodes, paragraphs, anchors };
}
