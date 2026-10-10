import type { Locator } from '@/types';
import { canonicalText, canonicalWalker } from './text';

/** 测量单个字符的实际列，支持同一段落跨多页。容器已有位移也不影响相对坐标。 */
function characterPage(
  root: HTMLElement,
  paragraph: HTMLElement,
  offset: number,
  stride: number,
): number {
  const walker = canonicalWalker(paragraph);
  let text = walker.nextNode();
  let start = Math.min(
    Math.max(0, offset),
    Math.max(0, canonicalText(paragraph).length - 1),
  );
  while (text && start >= (text.textContent?.length ?? 0)) {
    start -= text.textContent?.length ?? 0;
    text = walker.nextNode();
  }
  if (!text) {
    const rect = (
      paragraph.querySelector('img') ?? paragraph
    ).getBoundingClientRect();
    return Math.max(
      0,
      Math.floor((rect.left - root.getBoundingClientRect().left + 1) / stride),
    );
  }
  const range = document.createRange();
  const measure = (node: Node, index: number) => {
    const atom = node.parentElement?.closest('[data-md-atom]');
    if (atom) return atom.getBoundingClientRect();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    return Array.from(range.getClientRects()).find((rect) => rect.height > 0);
  };
  const originalText = text,
    originalStart = start;
  let rect = measure(text, start);
  // Collapsed source whitespace has no painted rectangle. In particular, a
  // trailing newline must not make a later-column paragraph appear on page 0.
  // Keep UTF-16 offsets intact; measure the preceding painted character.
  while (!rect && text) {
    if (--start < 0) {
      text = walker.previousNode();
      start = (text?.textContent?.length ?? 0) - 1;
    }
    if (text && start >= 0) rect = measure(text, start);
  }
  if (!rect) {
    walker.currentNode = originalText;
    text = originalText;
    start = originalStart;
    while (!rect && text) {
      if (++start >= (text.textContent?.length ?? 0)) {
        text = walker.nextNode();
        start = 0;
      }
      if (text && (text.textContent?.length ?? 0)) rect = measure(text, start);
    }
  }
  rect ??= (
    paragraph.querySelector('img') ?? paragraph
  ).getBoundingClientRect();
  return Math.max(
    0,
    Math.floor((rect.left - root.getBoundingClientRect().left + 1) / stride),
  );
}
export function pageOf(
  root: HTMLElement,
  locator: Locator,
  stride: number,
): number {
  const paragraph = root.querySelector<HTMLElement>(
    `[data-p="${locator.paragraphIndex}"]`,
  );
  return paragraph
    ? characterPage(
        root,
        paragraph,
        locator.charOffset - Number(paragraph.dataset.charStart ?? 0),
        stride,
      )
    : 0;
}
export function getLocator(
  root: HTMLElement,
  page: number,
  chapterIndex: number,
  stride: number,
): Locator {
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>('[data-p]'));
  for (const paragraph of paragraphs) {
    const text = canonicalText(paragraph);
    const length = text.length;
    if (characterPage(root, paragraph, Math.max(0, length - 1), stride) < page)
      continue;
    let low = 0,
      high = Math.max(0, length - 1);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (characterPage(root, paragraph, mid, stride) < page) low = mid + 1;
      else high = mid;
    }
    // 不把代理对的后半字符作为持久化锚点。
    if (low > 0 && /[\uDC00-\uDFFF]/.test(text[low]!)) low--;
    return {
      chapterIndex,
      paragraphIndex: Number(paragraph.dataset.p),
      charOffset: low + Number(paragraph.dataset.charStart ?? 0),
    };
  }
  const first = paragraphs[0];
  return {
    chapterIndex,
    paragraphIndex: Number(first?.dataset.p ?? 0),
    charOffset: Number(first?.dataset.charStart ?? 0),
  };
}
