import type { TextChapter } from '@/parsers/txt/chapters';
import type { SafeNode } from '@/parsers/epub/sanitize';
import type { Locator } from '@/types';
import { comparePosition, type TextPosition } from './annotation';

export const LONG_CHAPTER = 50_000;
export const CHUNK_CHARS = 12_000;
export const CHUNK_PARAGRAPHS = 128;
export interface ParagraphSlice {
  paragraphIndex: number;
  start: number;
  end: number;
}
export interface ChapterChunk {
  index: number;
  paragraphs: ParagraphSlice[];
}
const startOf = (chunk: ChapterChunk): TextPosition => ({
  paragraphIndex: chunk.paragraphs[0]?.paragraphIndex ?? 0,
  charOffset: chunk.paragraphs[0]?.start ?? 0,
});

/** Ordinary ruby bases and their readings must stay together. Text positions
 * still count every original UTF-16 code unit, including rt. An oversized ruby
 * follows the normal chunk budget so malformed markup cannot disable bounds.
 */
function rubyRanges(nodes: readonly SafeNode[]) {
  const result = new Map<number, { start: number; end: number }[]>();
  const visit = (node: SafeNode) => {
    if (typeof node === 'string') return;
    if (node.paragraphIndex === undefined) {
      node.children.forEach(visit);
      return;
    }
    const ranges: { start: number; end: number }[] = [];
    let offset = 0;
    const inline = (child: SafeNode) => {
      if (typeof child === 'string') {
        offset += child.length;
        return;
      }
      const start = offset;
      child.children.forEach(inline);
      if (
        (child.tag === 'ruby' ||
          child.math !== undefined ||
          child.diagram !== undefined) &&
        offset > start &&
        offset - start <= CHUNK_CHARS
      )
        ranges.push({ start, end: offset });
    };
    node.children.forEach(inline);
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const outer: typeof ranges = [];
    for (const range of ranges)
      if (!outer.length || range.start >= outer.at(-1)!.end) outer.push(range);
    if (outer.length) result.set(node.paragraphIndex, outer);
  };
  nodes.forEach(visit);
  return result;
}
/** 分块只生成原文范围，不修改章节、段落编号或持久化的UTF-16偏移。 */
export function chapterChunks(
  chapter: TextChapter & { nodes?: readonly SafeNode[] },
): ChapterChunk[] {
  if (chapter.charCount <= LONG_CHAPTER && chapter.paragraphs.length <= 512)
    return [
      {
        index: 0,
        paragraphs: chapter.paragraphs.map((text, paragraphIndex) => ({
          paragraphIndex,
          start: 0,
          end: text.length,
        })),
      },
    ];
  const chunks: ChapterChunk[] = [],
    protectedRanges = rubyRanges(chapter.nodes ?? []);
  let spans: ParagraphSlice[] = [],
    size = 0;
  const flush = () => {
    if (spans.length) chunks.push({ index: chunks.length, paragraphs: spans });
    spans = [];
    size = 0;
  };
  for (const [paragraphIndex, text] of chapter.paragraphs.entries()) {
    if (
      spans.length &&
      (size + text.length > CHUNK_CHARS || spans.length >= CHUNK_PARAGRAPHS)
    )
      flush();
    let start = 0,
      rangeIndex = 0;
    const ranges = protectedRanges.get(paragraphIndex) ?? [];
    do {
      let end = Math.min(text.length, start + CHUNK_CHARS - size);
      if (
        end < text.length &&
        end > start &&
        /[\uDC00-\uDFFF]/.test(text[end]!)
      )
        end--;
      while (ranges[rangeIndex] && ranges[rangeIndex]!.end <= end) rangeIndex++;
      const crossing = ranges[rangeIndex];
      if (crossing && crossing.start < end && crossing.end > end)
        end = crossing.start;
      if (end === start && start < text.length) {
        flush();
        continue;
      }
      spans.push({ paragraphIndex, start, end });
      size += end - start;
      start = end;
      if (
        start < text.length ||
        size >= CHUNK_CHARS ||
        spans.length >= CHUNK_PARAGRAPHS
      )
        flush();
    } while (start < text.length);
  }
  flush();
  return chunks.length ? chunks : [{ index: 0, paragraphs: [] }];
}
export function chunkForLocator(
  chunks: readonly ChapterChunk[],
  locator: TextPosition,
) {
  let low = 0,
    high = chunks.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (comparePosition(startOf(chunks[mid]!), locator) <= 0) low = mid;
    else high = mid - 1;
  }
  return chunks[low]!;
}
export function inChunk(
  chunk: ChapterChunk,
  locator: Locator,
  chunks: readonly ChapterChunk[],
) {
  return chunkForLocator(chunks, locator).index === chunk.index;
}

/** 截取行内树，保留强调/注音/本地图像，零长度元素在边界只归属一个块。 */
function sliceInline(
  nodes: readonly SafeNode[],
  start: number,
  end: number,
  length: number,
): SafeNode[] {
  let position = 0;
  const visit = (node: SafeNode): SafeNode[] => {
    if (typeof node === 'string') {
      const from = position;
      position += node.length;
      const text = node.slice(
        Math.max(0, start - from),
        Math.max(0, Math.min(node.length, end - from)),
      );
      return text ? [text] : [];
    }
    if (!node.children.length) {
      return position >= start &&
        (position < end || (position === end && end === length))
        ? [node]
        : [];
    }
    const children = node.children.flatMap(visit);
    return children.length ? [{ ...node, children }] : [];
  };
  return nodes.flatMap(visit);
}
export function nodesForChunk(
  nodes: readonly SafeNode[],
  chunk: ChapterChunk,
  paragraphs: readonly string[],
  chunks: readonly ChapterChunk[],
): SafeNode[] {
  const spans = new Map(
    chunk.paragraphs.map((span) => [span.paragraphIndex, span]),
  );
  let cursor: TextPosition = { paragraphIndex: 0, charOffset: 0 };
  const belongs = () => chunkForLocator(chunks, cursor).index === chunk.index;
  // 树内列表缩进、分隔线等未编号节点仍按原顺序保留一次。
  const visit = (node: SafeNode): SafeNode[] => {
    if (typeof node === 'string') return belongs() ? [node] : [];
    if (node.paragraphIndex !== undefined) {
      const span = spans.get(node.paragraphIndex);
      cursor = {
        paragraphIndex: node.paragraphIndex,
        charOffset: paragraphs[node.paragraphIndex]?.length ?? 0,
      };
      if (!span) return [];
      return [
        {
          ...node,
          children: sliceInline(
            node.children,
            span.start,
            span.end,
            paragraphs[node.paragraphIndex]?.length ?? 0,
          ),
        },
      ];
    }
    if (!node.children.length) return belongs() ? [node] : [];
    const pieces = node.children.map(visit);
    const children = pieces.flat();
    const first = pieces.findIndex((part) => part.length);
    const listStart =
      node.tag === 'ol' && node.start !== undefined
        ? { start: node.start + Math.max(0, first) }
        : {};
    return children.length ? [{ ...node, ...listStart, children }] : [];
  };
  return nodes.flatMap(visit);
}
