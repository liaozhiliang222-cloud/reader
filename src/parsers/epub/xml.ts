import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
export type XmlElement = Element;
export function decodeXml(bytes: Uint8Array) {
  const encoding =
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0x3c && bytes[1] === 0)
      ? 'utf-16le'
      : (bytes[0] === 0xfe && bytes[1] === 0xff) ||
          (bytes[0] === 0 && bytes[1] === 0x3c)
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error('章节XML编码无效，请重新导出EPUB。', { cause });
  }
}
export function parseXml(source: string): Document {
  // 禁止实体声明；普通 EPUB 公共 DOCTYPE 不会被加载。
  if (/<!ENTITY/i.test(source))
    throw new Error('文件包含不支持的 XML 实体声明。');
  return new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(message);
    },
  }).parseFromString(source, 'application/xhtml+xml');
}
export const localName = (el: Element) =>
  (el.localName || el.nodeName.split(':').pop() || '').toLowerCase();
export function elements(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(
    (el) => localName(el) === name,
  );
}
export function children(root: Element): Element[] {
  return Array.from(root.childNodes).filter(
    (node) => node.nodeType === 1,
  ) as Element[];
}
export function resolvePath(
  base: string,
  href: string,
): { path: string; fragment?: string } {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href) || href.includes('\\'))
    throw new Error('书籍包含不支持的资源路径。');
  const [part = '', fragment] = href.split('#');
  const decoded = decodeURIComponent(part);
  if (
    Array.from(decoded).some(
      (char) => char.charCodeAt(0) < 32 || char === '\\',
    ) ||
    decoded.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  )
    throw new Error('资源路径无效。');
  const segments = part ? base.split('/').slice(0, -1) : [];
  if (!part)
    return {
      path: base,
      fragment: fragment ? decodeURIComponent(fragment) : undefined,
    };
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) throw new Error('资源路径越出书籍目录。');
      segments.pop();
    } else segments.push(segment);
  }
  return {
    path: segments.join('/'),
    fragment: fragment ? decodeURIComponent(fragment) : undefined,
  };
}
