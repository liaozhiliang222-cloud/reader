import type { SafeNode } from '@/parsers/epub/sanitize';
import { getBlob } from '@/db/repository';
import { markdownLink } from '@/parsers/markdownLink';
const tags = new Set([
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
  'div',
  'code',
  'del',
  'a',
]);
export async function renderNodes(
  nodes: SafeNode[],
  starts?: ReadonlyMap<number, number>,
) {
  const ids = new Set<string>();
  const collect = (node: SafeNode) => {
    if (typeof node === 'string') return;
    if (node.imageId) ids.add(node.imageId);
    node.children.forEach(collect);
  };
  nodes.forEach(collect);
  const urls = new Map<string, string>();
  const visualUrls: string[] = [];
  try {
    for (const id of ids) {
      const blob = await getBlob(id);
      if (blob && /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(blob.data.type))
        urls.set(id, URL.createObjectURL(blob.data));
    }
    const fragment = document.createDocumentFragment();
    const enhancements: { el: HTMLElement; node: Exclude<SafeNode, string> }[] =
      [];
    const append = (node: SafeNode, parent: Node) => {
      if (typeof node === 'string') {
        parent.appendChild(document.createTextNode(node));
        return;
      }
      if (!tags.has(node.tag)) return;
      const el = document.createElement(node.tag);
      if (node.kind) el.dataset.mdKind = node.kind;
      if (node.tag === 'a') {
        const link = node.link ? markdownLink(node.link) : undefined;
        if (!link) return;
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.dataset.mdLink = link;
      }
      if (
        node.tag === 'ol' &&
        Number.isSafeInteger(node.start) &&
        node.start !== undefined
      )
        (el as HTMLOListElement).start = node.start;
      if (node.preformatted) el.dataset.preformatted = 'true';
      if (node.paragraphIndex !== undefined) {
        el.dataset.p = String(node.paragraphIndex);
        const start = starts?.get(node.paragraphIndex) ?? 0;
        if (start) el.dataset.charStart = String(start);
      }
      if (
        node.align &&
        ['left', 'center', 'right', 'justify'].includes(node.align)
      )
        el.dataset.align = node.align;
      if (node.tag === 'img') {
        const url = node.imageId ? urls.get(node.imageId) : undefined;
        if (!url) return;
        (el as HTMLImageElement).src = url;
        (el as HTMLImageElement).alt = node.alt ?? '';
      }
      node.children.forEach((child) => append(child, el));
      if (
        node.math !== undefined ||
        node.diagram !== undefined ||
        node.language
      )
        enhancements.push({ el, node });
      // EPUB links/figures may leave harmless inline wrappers around images.
      // Classify the rendered paragraph without changing stored text offsets.
      if (
        node.paragraphIndex !== undefined &&
        el.querySelector('img') &&
        !el.textContent?.trim()
      )
        el.dataset.imageOnly = 'true';
      parent.appendChild(el);
    };
    nodes.forEach((node) => append(node, fragment));
    if (enhancements.length) {
      const { enhanceMarkdown } = await import('./markdownVisuals');
      for (const { el, node } of enhancements) {
        const url = await enhanceMarkdown(el, node);
        if (url) visualUrls.push(url);
      }
    }
    return {
      fragment,
      release: () => {
        for (const url of urls.values()) URL.revokeObjectURL(url);
        for (const url of visualUrls) URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    for (const url of visualUrls) URL.revokeObjectURL(url);
    throw error;
  }
}
