/**
 * 从 StoredChapter 抽取可朗读内容：
 * - 代码块、公式源码、Mermaid、图片占位、表格按 SafeNode 标记整段跳过；
 * - ruby 只读正文不读注音；链接/双链只读显示文字；
 * - 行内过滤让一条句子可能对应多个原文区间，统一用 sourceRanges 记录，
 *   绝不把过滤后的文字偏移反写回原文偏移。
 */
import {
  textOf,
  type SafeElement,
  type SafeNode,
} from '@/parsers/epub/sanitize';
import { segmentText } from './segment';
import type { Locator, StoredChapter } from '@/types';

export interface SourceRange {
  paragraphIndex: number;
  start: number;
  end: number;
}

export interface ReadableSentence {
  /** 交给合成器的纯文本。 */
  text: string;
  chapterIndex: number;
  /** 句首 / 句尾定位（原文 UTF-16 偏移）。 */
  start: Locator;
  end: Locator;
  /** 句子在原文中的区间列表（可能因行内过滤分成多段）。 */
  sourceRanges: SourceRange[];
}

/** 整段或行内需要跳过的元素。 */
function skipElement(node: SafeElement): boolean {
  return (
    node.preformatted === true ||
    node.math !== undefined ||
    node.diagram !== undefined ||
    node.language !== undefined ||
    node.kind === 'table' ||
    node.kind === 'table-row' ||
    node.kind === 'table-cell' ||
    node.kind === 'image-placeholder'
  );
}

/** 行内不读的元素：注音。 */
const SKIP_INLINE = new Set(['rt']);

/**
 * 遍历段落元素子树，返回其中可读的 [start,end) 区间（相对段落 UTF-16 偏移）。
 * textOf 的拼接顺序与 paragraphs[] 存储文本一致，故用同一方式累计偏移。
 */
function readableRanges(children: SafeNode[], base: number): SourceRange[] {
  const ranges: SourceRange[] = [];
  let offset = base;
  const walk = (nodes: SafeNode[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        if (node.length)
          ranges.push({
            paragraphIndex: -1,
            start: offset,
            end: offset + node.length,
          });
        offset += node.length;
        continue;
      }
      if (skipElement(node) || SKIP_INLINE.has(node.tag)) {
        offset += textOf(node).length;
        continue;
      }
      walk(node.children);
    }
  };
  walk(children);
  return ranges;
}

/**
 * 标注章节中每个段落的可读性。
 * 返回 Map: paragraphIndex → 行内可读区间（无记录且未标 skipped 即整段可读）。
 */
export function analyzeChapter(chapter: StoredChapter): {
  skipped: Set<number>;
  ranges: Map<number, SourceRange[]>;
} {
  const skipped = new Set<number>();
  const ranges = new Map<number, SourceRange[]>();
  if (!chapter.nodes?.length) return { skipped, ranges };

  const visit = (nodes: SafeNode[], skipping: boolean) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      const skip = skipping || skipElement(node);
      if (node.paragraphIndex !== undefined) {
        if (skip) skipped.add(node.paragraphIndex);
        else if (!ranges.has(node.paragraphIndex)) {
          const kept = readableRanges(node.children, 0);
          // 行内过滤后才需要映射；整段可读时 ranges 为空可视为未过滤。
          const full = textOf(node).length;
          const filtered =
            kept.length !== 1 || kept[0]!.start !== 0 || kept[0]!.end !== full;
          if (filtered) ranges.set(node.paragraphIndex, kept);
        }
      }
      visit(node.children, skip);
    }
  };
  visit(chapter.nodes, false);
  return { skipped, ranges };
}

const hasContent = (text: string) => /[\p{L}\p{N}\p{S}]/u.test(text);

/**
 * 把一个段落按可读区间转成句子；readable 为全文与区间映射。
 * 空白/纯标点段以及被完全过滤的段落不产生句子。
 */
function paragraphSentences(
  chapter: StoredChapter,
  paragraphIndex: number,
  ranges: SourceRange[] | undefined,
): ReadableSentence[] {
  const full = chapter.paragraphs[paragraphIndex] ?? '';
  const kept = ranges ?? [{ paragraphIndex, start: 0, end: full.length }];
  if (!kept.length) return [];
  // 可读文字 = 各区间拼接；建立拼接偏移 → 原文区间的映射。
  let readable = '';
  const map: { textStart: number; textEnd: number; source: SourceRange }[] = [];
  for (const range of kept) {
    const start = Math.max(0, Math.min(range.start, full.length));
    const end = Math.max(start, Math.min(range.end, full.length));
    if (end <= start) continue;
    map.push({
      textStart: readable.length,
      textEnd: readable.length + (end - start),
      source: { paragraphIndex, start, end },
    });
    readable += full.slice(start, end);
  }
  if (!hasContent(readable)) return [];

  const result: ReadableSentence[] = [];
  for (const span of segmentText(readable)) {
    const piece = readable.slice(span.start, span.end);
    if (!hasContent(piece)) continue;
    // 句子覆盖的拼接区间 → 裁剪后的原文区间。
    const sources: SourceRange[] = [];
    for (const m of map) {
      const a = Math.max(span.start, m.textStart);
      const b = Math.min(span.end, m.textEnd);
      if (b <= a) continue;
      sources.push({
        paragraphIndex,
        start: m.source.start + (a - m.textStart),
        end: m.source.start + (b - m.textStart),
      });
    }
    if (!sources.length) continue;
    result.push({
      text: piece,
      chapterIndex: chapter.index,
      start: {
        chapterIndex: chapter.index,
        paragraphIndex,
        charOffset: sources[0]!.start,
      },
      end: {
        chapterIndex: chapter.index,
        paragraphIndex: sources.at(-1)!.paragraphIndex,
        charOffset: sources.at(-1)!.end,
      },
      sourceRanges: sources,
    });
  }
  return result;
}

/**
 * 抽取整章的可读句；返回空数组表示本章没有可读内容。
 * 没有 nodes 的章节（TXT/粘贴稿）所有非空白段都可读。
 */
export function chapterSentences(chapter: StoredChapter): ReadableSentence[] {
  const { skipped, ranges } = analyzeChapter(chapter);
  const result: ReadableSentence[] = [];
  for (let index = 0; index < chapter.paragraphs.length; index++) {
    if (skipped.has(index)) continue;
    result.push(...paragraphSentences(chapter, index, ranges.get(index)));
  }
  return result;
}
