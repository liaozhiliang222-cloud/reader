import type { TextChapter } from '@/parsers/txt/chapters';
import type { ChapterSummary, Locator } from '@/types';
const finite = (value: number) => (Number.isFinite(value) ? value : 0);
export function clampLocator(chapter: TextChapter, target: Locator): Locator {
  const paragraphIndex = Math.max(
    0,
    Math.min(
      chapter.paragraphs.length - 1,
      Math.floor(finite(target.paragraphIndex)),
    ),
  );
  const text = chapter.paragraphs[paragraphIndex] ?? '';
  let charOffset = Math.max(
    0,
    Math.min(text.length, Math.floor(finite(target.charOffset))),
  );
  if (charOffset > 0 && /[\uDC00-\uDFFF]/.test(text[charOffset] ?? ''))
    charOffset--;
  return { chapterIndex: chapter.index, paragraphIndex, charOffset };
}
export function locatorOffset(chapter: TextChapter, target: Locator): number {
  const locator = clampLocator(chapter, target);
  return (
    chapter.paragraphs
      .slice(0, locator.paragraphIndex)
      .reduce((sum, text) => sum + text.length, 0) + locator.charOffset
  );
}
export function locatorAtOffset(chapter: TextChapter, offset: number): Locator {
  let remaining = Math.max(
    0,
    Math.min(chapter.charCount, Math.floor(finite(offset))),
  );
  for (const [paragraphIndex, text] of chapter.paragraphs.entries()) {
    if (remaining < text.length || (remaining === 0 && text.length === 0))
      return clampLocator(chapter, {
        chapterIndex: chapter.index,
        paragraphIndex,
        charOffset: remaining,
      });
    remaining -= text.length;
  }
  return clampLocator(chapter, {
    chapterIndex: chapter.index,
    paragraphIndex: chapter.paragraphs.length - 1,
    charOffset: chapter.paragraphs.at(-1)?.length ?? 0,
  });
}
export function percentOf(
  chapter: TextChapter,
  locator: Locator,
  total: number,
): number {
  return Math.min(
    100,
    Math.max(
      0,
      ((chapter.charStart + locatorOffset(chapter, locator)) /
        Math.max(1, total)) *
        100,
    ),
  );
}
export function chapterAtPercent(
  chapters: ChapterSummary[],
  total: number,
  percent: number,
): { chapter: ChapterSummary; offset: number } | undefined {
  if (!chapters.length) return;
  const value = Math.max(0, Math.min(100, finite(percent)));
  if (total <= 0) {
    const chapter =
      chapters[
        Math.min(
          chapters.length - 1,
          Math.floor((value / 100) * chapters.length),
        )
      ]!;
    return { chapter, offset: 0 };
  }
  const position = Math.floor((total * value) / 100);
  let low = 0,
    high = chapters.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (chapters[mid]!.charStart <= position) low = mid;
    else high = mid - 1;
  }
  const chapter = chapters[low]!;
  return {
    chapter,
    offset: Math.min(
      chapter.charCount,
      Math.max(0, position - chapter.charStart),
    ),
  };
}
