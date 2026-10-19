import { t } from '@/i18n';
import { XMLSerializer } from '@xmldom/xmldom';
import { BoundedZip } from '@/parsers/zip';
import { sanitizeChapter, type SafeNode } from '@/parsers/epub/sanitize';
import { sanitizeSvg, svgLocalImages } from '@/parsers/epub/svg';
import {
  decodeXml,
  elements,
  localName,
  parseXml,
  resolvePath,
  type XmlElement,
} from '@/parsers/epub/xml';
import type { EpubParserVersion } from '@/parsers/epub/version';
import type { StoredChapter } from '@/types';

const excludedTags = new Set([
  'table',
  'pre',
  'code',
  'rt',
  'rp',
  'math',
  'svg',
]);

/** Recover semantics lost by old EPUB parsers without reparsing/saving a book.
 * The unchanged versioned sanitizer runs twice. Masking preserves every UTF-16
 * unit and whitespace; both results must match persisted canonical paragraphs. */
export function speechChapterFromXhtml(
  source: string,
  path: string,
  stored: StoredChapter,
  version: EpubParserVersion,
  images: ReadonlyMap<string, string>,
): StoredChapter {
  let marker = '';
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const candidate = String.fromCharCode(code);
    if (
      !source.includes(candidate) &&
      !stored.paragraphs.some((p) => p.includes(candidate))
    ) {
      marker = candidate;
      break;
    }
  }
  if (!marker) throw new Error(t('本章结构无法安全映射为听书文本。'));
  const svg = (element: XmlElement): SafeNode[] =>
    sanitizeSvg(element)
      ? [{ tag: 'img', children: [], imageId: 'speech-inline-image' }]
      : svgLocalImages(element, path, images);
  const original = sanitizeChapter(source, path, images, version, svg);
  if (
    original.paragraphs.length !== stored.paragraphs.length ||
    original.paragraphs.some((p, index) => p !== stored.paragraphs[index])
  )
    throw new Error(t('书籍原文与阅读位置不一致，听书准备已停止。'));
  const document = parseXml(source);
  const mask = (element: XmlElement, excluded = false) => {
    const skip = excluded || excludedTags.has(localName(element));
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 1) mask(node as XmlElement, skip);
      else if (skip && (node.nodeType === 3 || node.nodeType === 4))
        node.nodeValue = (node.nodeValue ?? '').replace(/\S/gu, (char) =>
          marker.repeat(char.length),
        );
    }
  };
  if (document.documentElement) mask(document.documentElement);
  const masked = sanitizeChapter(
    new XMLSerializer().serializeToString(document),
    path,
    images,
    version,
    svg,
  );
  if (masked.paragraphs.length !== stored.paragraphs.length)
    throw new Error(t('本章结构无法安全映射为听书文本。'));
  const nodes: SafeNode[] = stored.paragraphs.map(
    (paragraph, paragraphIndex) => {
      const filtered = masked.paragraphs[paragraphIndex]!;
      if (filtered.length !== paragraph.length)
        throw new Error(t('本章结构无法安全映射为听书文本。'));
      const children: SafeNode[] = [];
      let start = 0;
      while (start < paragraph.length) {
        const skip = filtered[start] === marker;
        let end = start + 1;
        while (end < paragraph.length && (filtered[end] === marker) === skip)
          end++;
        const value = paragraph.slice(start, end);
        if (!skip && filtered.slice(start, end) !== value)
          throw new Error(t('本章结构无法安全映射为听书文本。'));
        children.push(
          skip ? { tag: 'span', speechSkip: true, children: [value] } : value,
        );
        start = end;
      }
      return { tag: 'p', paragraphIndex, children };
    },
  );
  return { ...stored, nodes };
}

/** Opens only metadata, SVG metadata and requested XHTML chapters. No full-book
 * DOM/text cache, no new database copy, and no external resource resolution. */
export async function openEpubSpeechSource(
  original: Blob,
  version: EpubParserVersion,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const zip = await BoundedZip.load(original, {
    input: 50 * 1024 * 1024,
    entries: 20000,
    entry: 50 * 1024 * 1024,
    total: 150 * 1024 * 1024,
  });
  const read = async (path: string) => {
    signal.throwIfAborted();
    const value = decodeXml(
      new Uint8Array(await (await zip.read(path)).arrayBuffer()),
    );
    signal.throwIfAborted();
    return value;
  };
  const container = parseXml(await read('META-INF/container.xml'));
  const root = elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!root) throw new Error(t('书籍原件缺少章节清单，无法准备听书。'));
  const opfPath = resolvePath('', root).path;
  const opf = parseXml(await read(opfPath));
  const manifest = new Map(
    elements(opf, 'item').map((item) => [item.getAttribute('id') ?? '', item]),
  );
  const paths = elements(opf, 'itemref').map((ref) => {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item) throw new Error(t('书籍章节清单不完整，无法准备听书。'));
    return resolvePath(opfPath, item.getAttribute('href') ?? '').path;
  });
  const images = new Map<string, string>();
  for (const item of manifest.values()) {
    const type = item.getAttribute('media-type') ?? '';
    if (
      !(
        version === 3
          ? /^image\/(png|jpeg|gif|webp|svg\+xml)$/
          : /^image\/(png|jpeg|gif|webp)$/
      ).test(type)
    )
      continue;
    const path = resolvePath(opfPath, item.getAttribute('href') ?? '').path;
    if (
      zip.has(path) &&
      (type !== 'image/svg+xml' || sanitizeSvg(await read(path)))
    )
      images.set(path, 'speech-image');
  }
  return async (stored: StoredChapter) => {
    const path = paths[stored.index];
    if (!path) throw new Error(t('书籍原件缺少对应章节，无法准备听书。'));
    return speechChapterFromXhtml(
      await read(path),
      path,
      stored,
      version,
      images,
    );
  };
}
