import type { Highlight } from '@/types';

export type TextPosition = Highlight['start'];
export interface TextSpan {
  chapterIndex: number;
  start: TextPosition;
  end: TextPosition;
}
export const comparePosition = (a: TextPosition, b: TextPosition) =>
  a.paragraphIndex - b.paragraphIndex || a.charOffset - b.charOffset;

/** 偏移为 UTF-16，端点不得拆开代理对；空范围和越界范围不保存。 */
export function normalizeSpan(
  paragraphs: readonly string[],
  span: TextSpan,
): TextSpan | undefined {
  if (!Number.isInteger(span.chapterIndex) || span.chapterIndex < 0) return;
  let start = { ...span.start },
    end = { ...span.end };
  if (comparePosition(start, end) > 0) [start, end] = [end, start];
  if (comparePosition(start, end) === 0) return;
  for (const point of [start, end]) {
    const text = paragraphs[point.paragraphIndex];
    if (
      !Number.isInteger(point.paragraphIndex) ||
      !Number.isInteger(point.charOffset) ||
      text === undefined ||
      point.charOffset < 0 ||
      point.charOffset > text!.length
    )
      return;
  }
  const insidePair = (point: TextPosition) => {
    const text = paragraphs[point.paragraphIndex]!;
    return (
      point.charOffset > 0 &&
      /[\uD800-\uDBFF]/.test(text[point.charOffset - 1]!) &&
      /[\uDC00-\uDFFF]/.test(text[point.charOffset] ?? '')
    );
  };
  if (insidePair(start)) start.charOffset--;
  if (insidePair(end)) end.charOffset++;
  if (comparePosition(start, end) >= 0) return;
  const result = { chapterIndex: span.chapterIndex, start, end };
  return spanText(paragraphs, result).trim() ? result : undefined;
}
export function spanText(paragraphs: readonly string[], span: TextSpan) {
  return paragraphs
    .slice(span.start.paragraphIndex, span.end.paragraphIndex + 1)
    .map((text, index) =>
      text.slice(
        index === 0 ? span.start.charOffset : 0,
        span.start.paragraphIndex + index === span.end.paragraphIndex
          ? span.end.charOffset
          : undefined,
      ),
    )
    .join('\n');
}
export function compareHighlights(a: Highlight, b: Highlight) {
  return (
    a.chapterIndex - b.chapterIndex ||
    comparePosition(a.start, b.start) ||
    comparePosition(a.end, b.end) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}
export function groupHighlights(items: readonly Highlight[]) {
  const groups = new Map<number, Highlight[]>();
  for (const item of [...items].sort(compareHighlights)) {
    const chapterIndex = item.unanchored ? -1 : item.chapterIndex;
    const group = groups.get(chapterIndex) ?? [];
    group.push(item);
    groups.set(chapterIndex, group);
  }
  return [...groups].map(([chapterIndex, highlights]) => ({
    chapterIndex,
    highlights,
  }));
}

export interface HighlightSegment {
  start: number;
  end: number;
  items: Highlight[];
}
/** 重叠范围切成互不重叠的片段，最后创建的颜色显示在最上层。 */
export function highlightSegments(
  length: number,
  spans: { start: number; end: number; item: Highlight }[],
): HighlightSegment[] {
  const valid = spans.filter(
    (span) => span.end > span.start && span.end > 0 && span.start < length,
  );
  const boundaries = [
    ...new Set([
      0,
      length,
      ...valid.flatMap((span) => [
        Math.max(0, span.start),
        Math.min(length, span.end),
      ]),
    ]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => ({
    start,
    end: boundaries[index + 1]!,
    items: valid
      .filter((span) => span.start < boundaries[index + 1]! && span.end > start)
      .map((span) => span.item)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
  }));
}
