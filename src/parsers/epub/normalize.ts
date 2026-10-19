import { t } from '@/i18n';
import {
  elements,
  localName,
  parseXml,
  resolvePath,
  type XmlElement,
} from './xml';
import { textOf, type SafeElement, type SafeNode } from './sanitize';
const allowed = new Set(
  'p h1 h2 h3 h4 h5 h6 em strong b i img br blockquote ul ol li sup sub ruby rt hr span'.split(
    ' ',
  ),
);
const dropped = new Set(
  'script style iframe object embed form input button link meta svg math audio video source noscript template'.split(
    ' ',
  ),
);
const blocks = new Set('p h1 h2 h3 h4 h5 h6 blockquote li'.split(' '));
const containers = new Set(
  'body div section article aside header footer main table thead tbody tfoot'.split(
    ' ',
  ),
);

/** v2 normalizes text/anchors; v3 adds the optional safe image handler.
 * Old versions remain available for restoring persisted paragraph locators. */
export function sanitizeModernChapter(
  source: string,
  path: string,
  images: ReadonlyMap<string, string>,
  svg?: (element: XmlElement) => SafeNode[],
) {
  const doc = parseXml(source),
    body = elements(doc, 'body')[0] ?? doc.documentElement;
  if (!body) throw new Error(t('章节正文不存在。'));
  const ids = new Map<SafeElement, string[]>(),
    paragraphs: string[] = [];
  const anchors: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  const hasParagraph = (node: SafeNode): boolean =>
    typeof node !== 'string' &&
    (node.paragraphIndex !== undefined || node.children.some(hasParagraph));
  const flow = (content: SafeNode[]) => {
    const result: SafeNode[] = [];
    let inline: SafeNode[] = [];
    const flush = () => {
      if (
        inline.some((node) => typeof node !== 'string') ||
        inline.map(textOf).join('').trim()
      )
        result.push({ tag: 'p', children: inline, paragraphIndex: -1 });
      inline = [];
    };
    for (const node of content) {
      if (hasParagraph(node)) {
        flush();
        result.push(node);
      } else inline.push(node);
    }
    flush();
    return result;
  };
  const mark = (node: SafeElement, el: XmlElement, descendants = false) => {
    const targets = descendants
      ? [el, ...Array.from(el.getElementsByTagName('*'))]
      : [el];
    const values = targets
      .map((target) => target.getAttribute('id'))
      .filter((id): id is string => !!id);
    if (values.length) ids.set(node, [...(ids.get(node) ?? []), ...values]);
    return node;
  };
  const clean = (el: XmlElement): SafeNode[] => {
    const tag = localName(el);
    if (tag === 'svg' && svg) {
      const nodes = svg(el);
      if (nodes[0] && typeof nodes[0] !== 'string') mark(nodes[0], el);
      return nodes;
    }
    if (dropped.has(tag)) return [];
    if (tag === 'img') {
      let imageId: string | undefined;
      try {
        imageId = images.get(
          resolvePath(path, el.getAttribute('src') ?? '').path,
        );
      } catch {
        /* 不保留外部图像 */
      }
      return imageId
        ? [
            mark(
              {
                tag: 'img',
                children: [],
                imageId,
                alt: el.getAttribute('alt') ?? '',
              },
              el,
            ),
          ]
        : [];
    }
    if (tag === 'tr') {
      const cells = Array.from(el.childNodes).filter(
        (node) =>
          node.nodeType === 1 &&
          ['td', 'th'].includes(localName(node as XmlElement)),
      );
      return [
        mark(
          {
            tag: 'p',
            paragraphIndex: -1,
            children: [
              cells
                .map((cell) =>
                  clean(cell as XmlElement)
                    .map(textOf)
                    .join('')
                    .trim(),
                )
                .join(' | '),
            ],
          },
          el,
          true,
        ),
      ];
    }
    const content = Array.from(el.childNodes).flatMap((node): SafeNode[] =>
      node.nodeType === 3 || node.nodeType === 4
        ? [node.nodeValue ?? '']
        : node.nodeType === 1
          ? clean(node as XmlElement)
          : [],
    );
    if (
      containers.has(tag) ||
      (!allowed.has(tag) && content.some(hasParagraph))
    ) {
      const nodes = flow(content),
        first = nodes.find(
          (node): node is SafeElement => typeof node !== 'string',
        );
      if (first) mark(first, el);
      return nodes;
    }
    const normalizedTag =
      tag === 'pre' || tag === 'caption'
        ? 'p'
        : allowed.has(tag)
          ? tag
          : 'span';
    const result = mark({ tag: normalizedTag, children: content }, el);
    const align = (
      el.getAttribute('align') ||
      /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i.exec(
        el.getAttribute('style') ?? '',
      )?.[1]
    )?.toLowerCase();
    if (align && ['left', 'center', 'right', 'justify'].includes(align))
      result.align = align as SafeElement['align'];
    if (tag === 'pre') result.preformatted = true;
    if (blocks.has(normalizedTag)) {
      if (content.some(hasParagraph)) result.children = flow(content);
      else result.paragraphIndex = -1;
    }
    return [result];
  };
  const nodes = flow(clean(body));
  const recordIds = (node: SafeElement, index: number) => {
    for (const id of ids.get(node) ?? [])
      if (!(id in anchors)) anchors[id] = index;
  };
  const inlineIds = (node: SafeNode, index: number) => {
    if (typeof node === 'string') return;
    recordIds(node, index);
    node.children.forEach((child) => inlineIds(child, index));
  };
  const indexNode = (node: SafeNode) => {
    if (typeof node === 'string') return;
    const first = paragraphs.length;
    if (node.paragraphIndex !== undefined) {
      node.paragraphIndex = first;
      paragraphs.push(textOf(node));
      inlineIds(node, first);
    } else {
      node.children.forEach(indexNode);
      if (paragraphs.length > first) recordIds(node, first);
    }
  };
  nodes.forEach(indexNode);
  return { nodes, paragraphs, anchors };
}
