import {
  normalizeSpan,
  spanText,
  type TextPosition,
  type TextSpan,
} from './annotation';
import { canonicalText, canonicalWalker, rangeText } from './text';

/** 根据段落内全部文本节点计数，兼容强调、注音与 mark 拆分后的节点。 */
function textPoint(
  paragraph: HTMLElement,
  offset: number,
): { node: Node; offset: number } | undefined {
  if (offset < 0 || offset > canonicalText(paragraph).length) return;
  const walker = canonicalWalker(paragraph);
  let node = walker.nextNode();
  let remaining = offset;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }
  return offset === 0 ? { node: paragraph, offset: 0 } : undefined;
}
export function rangeForSpan(
  root: HTMLElement,
  span: TextSpan,
): Range | undefined {
  if (root.dataset.chunked !== 'true') {
    for (const position of [span.start, span.end]) {
      const p = root.querySelector<HTMLElement>(
        `[data-p="${position.paragraphIndex}"]`,
      );
      if (
        !p ||
        !textPoint(p, position.charOffset - Number(p.dataset.charStart ?? 0))
      )
        return;
    }
  }
  let start: ReturnType<typeof textPoint>, end: ReturnType<typeof textPoint>;
  for (const p of root.querySelectorAll<HTMLElement>('[data-p]')) {
    const index = Number(p.dataset.p),
      offset = Number(p.dataset.charStart ?? 0);
    if (index < span.start.paragraphIndex || index > span.end.paragraphIndex)
      continue;
    const length = canonicalText(p).length;
    const from = Math.max(
      0,
      span.start.paragraphIndex === index ? span.start.charOffset - offset : 0,
    );
    const to = Math.min(
      length,
      span.end.paragraphIndex === index ? span.end.charOffset - offset : length,
    );
    if (to <= from) continue;
    start ??= textPoint(p, from);
    end = textPoint(p, to);
  }
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.collapsed ? undefined : range;
}
export function spanFromRange(
  root: HTMLElement,
  chapterIndex: number,
  paragraphs: readonly string[],
  range: Range,
) {
  if (
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return;
  let start: TextPosition | undefined, end: TextPosition | undefined;
  for (const p of root.querySelectorAll<HTMLElement>('[data-p]')) {
    if (!range.intersectsNode(p)) continue;
    const portion = document.createRange();
    portion.selectNodeContents(p);
    if (range.compareBoundaryPoints(Range.START_TO_START, portion) > 0)
      portion.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, portion) < 0)
      portion.setEnd(range.endContainer, range.endOffset);
    if (!rangeText(portion)) continue;
    const prefix = document.createRange();
    prefix.selectNodeContents(p);
    prefix.setEnd(portion.startContainer, portion.startOffset);
    const a = rangeText(prefix).length;
    prefix.setEnd(portion.endContainer, portion.endOffset);
    const offset = Number(p.dataset.charStart ?? 0);
    start ??= { paragraphIndex: Number(p.dataset.p), charOffset: a + offset };
    end = {
      paragraphIndex: Number(p.dataset.p),
      charOffset: rangeText(prefix).length + offset,
    };
  }
  if (!start || !end) return;
  const span = normalizeSpan(paragraphs, { chapterIndex, start, end });
  return span ? { ...span, text: spanText(paragraphs, span) } : undefined;
}

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function visibleRangeRect(
  range: Range,
  frame: HTMLElement,
): SelectionRect | undefined {
  const viewport = frame.getBoundingClientRect();
  const rects = [...range.getClientRects()].filter(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > viewport.left &&
      rect.left < viewport.right &&
      rect.bottom > viewport.top &&
      rect.top < viewport.bottom,
  );
  if (!rects.length) return;
  return {
    left: Math.max(viewport.left, Math.min(...rects.map((r) => r.left))),
    right: Math.min(viewport.right, Math.max(...rects.map((r) => r.right))),
    top: Math.max(viewport.top, Math.min(...rects.map((r) => r.top))),
    bottom: Math.min(viewport.bottom, Math.max(...rects.map((r) => r.bottom))),
  };
}
export function selectionMenuPosition(
  rect: SelectionRect,
  width: number,
  height: number,
  viewport: SelectionRect,
) {
  const gap = 8;
  const left = Math.max(
    viewport.left + gap,
    Math.min(
      (rect.left + rect.right - width) / 2,
      viewport.right - width - gap,
    ),
  );
  const above = rect.top - gap - height;
  const top = Math.max(
    viewport.top + gap,
    Math.min(
      above >= viewport.top + gap ? above : rect.bottom + gap,
      viewport.bottom - height - gap,
    ),
  );
  return { left, top };
}
