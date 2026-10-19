import { t } from '@/i18n';
import { BoundedZip } from '@/parsers/zip';
import { obfuscatedFonts, validateObfuscatedFonts } from './encryption';
import {
  elements,
  decodeXml,
  localName,
  parseXml,
  resolvePath,
  type XmlElement,
} from './xml';
import { sanitizeChapter, type SafeNode } from './sanitize';
import { sanitizeSvg, svgLocalImages } from './svg';
import { EPUB_PARSER_VERSION, type EpubParserVersion } from './version';
import type { TextChapter } from '@/parsers/txt/chapters';

export interface TocEntry {
  anchor?: string;
  title: string;
  chapterIndex: number;
  paragraphIndex: number;
  level: number;
}
export interface EpubChapter extends TextChapter {
  nodes: SafeNode[];
  anchors: Record<string, number>;
  path: string;
}
export interface EpubAsset {
  id: string;
  data: Blob;
}
export async function parseEpub(
  buffer: ArrayBuffer,
  id: string,
  parserVersion: EpubParserVersion = EPUB_PARSER_VERSION,
) {
  const zip = await BoundedZip.load(buffer, {
    input: 50 * 1024 * 1024,
    entries: 20000,
    entry: 50 * 1024 * 1024,
    total: 150 * 1024 * 1024,
  });
  const read = async (path: string) => {
    return new Uint8Array(await (await zip.read(path)).arrayBuffer());
  };
  const xml = async (path: string) => parseXml(decodeXml(await read(path)));
  const container = await xml('META-INF/container.xml');
  const fonts = zip.has('META-INF/encryption.xml')
    ? obfuscatedFonts(decodeXml(await read('META-INF/encryption.xml')))
    : [];
  const opfHref = elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfHref) throw new Error(t('文件无法解析：缺少 OPF 路径。'));
  const opfPath = resolvePath('', opfHref).path;
  const opf = await xml(opfPath);
  const title = elements(opf, 'title')[0]?.textContent?.trim() || '未命名书籍';
  const author = elements(opf, 'creator')[0]?.textContent?.trim() || undefined;
  const manifest = new Map(
    elements(opf, 'item').map((el) => [el.getAttribute('id') ?? '', el]),
  );
  const paths = elements(opf, 'itemref').map((ref) => {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item) throw new Error(t('文件无法解析：章节清单不完整。'));
    return resolvePath(opfPath, item.getAttribute('href') ?? '').path;
  });
  if (!paths.length) throw new Error(t('文件无法解析：书籍没有章节。'));
  validateObfuscatedFonts(fonts, manifest.values(), opfPath, paths, (path) =>
    zip.has(path),
  );
  const assets: EpubAsset[] = [];
  const images = new Map<string, string>();
  const imageItems = Array.from(manifest.values()).filter((el) =>
    (parserVersion === 3
      ? /^image\/(png|jpeg|gif|webp|svg\+xml)$/
      : /^image\/(png|jpeg|gif|webp)$/
    ).test(el.getAttribute('media-type') ?? ''),
  );
  for (const item of imageItems) {
    const path = resolvePath(opfPath, item.getAttribute('href') ?? '').path;
    const data = await read(path),
      assetId = `${id}:image:${assets.length}`;
    const type = item.getAttribute('media-type')!;
    const svg =
      type === 'image/svg+xml' ? sanitizeSvg(decodeXml(data)) : undefined;
    if (type === 'image/svg+xml' && !svg) continue;
    assets.push({
      id: assetId,
      data: new Blob([svg ?? Uint8Array.from(data).buffer], { type }),
    });
    images.set(path, assetId);
  }
  const legacyCover = elements(opf, 'meta')
    .find((el) => el.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const cover =
    imageItems.find((el) =>
      (el.getAttribute('properties') ?? '')
        .split(/\s+/)
        .includes('cover-image'),
    ) ??
    imageItems.find((el) => el.getAttribute('id') === legacyCover) ??
    imageItems[0];
  const coverBlobId = cover
    ? images.get(resolvePath(opfPath, cover.getAttribute('href') ?? '').path)
    : undefined;
  const chapters: EpubChapter[] = [];
  let charStart = 0;
  for (const [index, path] of paths.entries()) {
    const sanitized = sanitizeChapter(
      decodeXml(await read(path)),
      path,
      images,
      parserVersion,
      (el) => {
        const svg = sanitizeSvg(el);
        if (!svg) return svgLocalImages(el, path, images);
        const imageId = `${id}:image:${assets.length}`;
        assets.push({
          id: imageId,
          data: new Blob([svg], { type: 'image/svg+xml' }),
        });
        return [
          {
            tag: 'img',
            children: [],
            imageId,
            alt: elements(el, 'title')[0]?.textContent ?? '',
          },
        ];
      },
    );
    const charCount = sanitized.paragraphs.reduce((n, p) => n + p.length, 0);
    chapters.push({
      ...sanitized,
      index,
      path,
      title: `第 ${index + 1} 节`,
      charStart,
      charCount,
    });
    charStart += charCount;
  }
  const toc: TocEntry[] = [];
  const add = (label: string, href: string, base: string, level: number) => {
    let target;
    try {
      target = resolvePath(base, href);
    } catch {
      return;
    }
    const index = paths.indexOf(target.path);
    if (index < 0) return;
    const chapter = chapters[index]!;
    toc.push({
      title: label.trim() || chapter.title,
      chapterIndex: index,
      paragraphIndex: target.fragment
        ? (chapter.anchors[target.fragment] ?? 0)
        : 0,
      level,
    });
    if (chapter.title === `第 ${index + 1} 节`)
      chapter.title = label.trim() || chapter.title;
  };
  const navItem = Array.from(manifest.values()).find((el) =>
    (el.getAttribute('properties') ?? '').split(/\s+/).includes('nav'),
  );
  if (navItem) {
    const path = resolvePath(opfPath, navItem.getAttribute('href') ?? '').path,
      nav = await xml(path);
    const root = elements(nav, 'nav').find((el) =>
      (el.getAttribute('epub:type') ?? el.getAttribute('type') ?? '')
        .split(/\s+/)
        .includes('toc'),
    );
    if (root)
      for (const a of elements(root, 'a')) {
        let level = -1;
        let parent = a.parentNode;
        while (parent && parent !== root) {
          if (parent.nodeType === 1 && localName(parent as XmlElement) === 'ol')
            level++;
          parent = parent.parentNode;
        }
        add(
          a.textContent ?? '',
          a.getAttribute('href') ?? '',
          path,
          Math.max(0, level),
        );
      }
  }
  if (!toc.length) {
    const ncxId = elements(opf, 'spine')[0]?.getAttribute('toc');
    const ncx =
      (ncxId ? manifest.get(ncxId) : undefined) ??
      Array.from(manifest.values()).find(
        (el) => el.getAttribute('media-type') === 'application/x-dtbncx+xml',
      );
    if (ncx) {
      const path = resolvePath(opfPath, ncx.getAttribute('href') ?? '').path,
        doc = await xml(path);
      for (const point of elements(doc, 'navpoint')) {
        let level = 0,
          parent = point.parentNode;
        while (parent) {
          if (
            parent.nodeType === 1 &&
            localName(parent as XmlElement) === 'navpoint'
          )
            level++;
          parent = parent.parentNode;
        }
        add(
          elements(point, 'text')[0]?.textContent ?? '',
          elements(point, 'content')[0]?.getAttribute('src') ?? '',
          path,
          level,
        );
      }
    }
  }
  if (!toc.length)
    toc.push(
      ...chapters.map((c) => ({
        title: c.title,
        chapterIndex: c.index,
        paragraphIndex: 0,
        level: 0,
      })),
    );
  else if (parserVersion !== 1) {
    // Some real editions list only a license/appendix in their navigation.
    // Supply missing readable spine sections without changing text offsets,
    // publisher fragment targets or the relative order of existing entries.
    const readableImage = (node: SafeNode): boolean =>
      typeof node !== 'string' &&
      (!!node.imageId || node.children.some(readableImage));
    const covered = new Set(toc.map((entry) => entry.chapterIndex));
    for (const chapter of chapters) {
      if (
        covered.has(chapter.index) ||
        (!chapter.charCount && !chapter.nodes.some(readableImage))
      )
        continue;
      const entry = {
        title: chapter.title,
        chapterIndex: chapter.index,
        paragraphIndex: 0,
        level: 0,
      };
      const following = toc.findIndex(
        (item) => item.chapterIndex > chapter.index,
      );
      toc.splice(following < 0 ? toc.length : following, 0, entry);
    }
  }
  await zip.verifyRemaining();
  return {
    parserVersion,
    title,
    author,
    coverBlobId,
    chapters,
    toc,
    assets,
    charCount: charStart,
  };
}
