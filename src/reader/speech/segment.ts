import type { Locator, StoredChapter } from '@/types';
import { extractSpeech, type SpeechParagraph } from './extract';

export interface SourceRange {
  start: Locator;
  end: Locator;
}
export interface SpeechSentence {
  id: string;
  text: string;
  chapterTitle: string;
  start: Locator;
  end: Locator;
  sourceRanges: SourceRange[];
}
const closers = /[”’」』】）》〉"')\]]/;
const abbreviations =
  /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\be\.g|\bi\.e|\b[A-Z])\.$/i;

function sentenceEnd(text: string, index: number): number | undefined {
  const char = text[index]!;
  if (!/[。！？；….!?]/.test(char)) return;
  if (char === '.' && text[index + 1] !== '.') {
    if (text[index - 1] === '.') {
      // Last dot of an ellipsis is a boundary.
    } else if (
      /\d/.test(text[index - 1] ?? '') &&
      /\d/.test(text[index + 1] ?? '')
    ) {
      return;
    } else if (
      abbreviations.test(text.slice(Math.max(0, index - 12), index + 1)) ||
      /[\p{L}\p{N}]/u.test(text[index + 1] ?? '')
    ) {
      return;
    }
  }
  let end = index + 1;
  while (end < text.length && /[。！？；….!?]/.test(text[end]!)) end++;
  while (end < text.length && closers.test(text[end]!)) end++;
  return end;
}

function safeCut(text: string, end: number) {
  return end > 0 && /[\uDC00-\uDFFF]/.test(text[end] ?? '') ? end - 1 : end;
}

/** Bounded UTF-16 ranges; keep punctuation/closing quotes on their sentence. */
export function sentenceSlices(text: string, limit = 120) {
  if (!Number.isInteger(limit) || limit < 2 || limit > 4000)
    throw new Error('单句长度限制无效。');
  const spans: { start: number; end: number }[] = [];
  const append = (start: number, end: number) => {
    while (start < end) {
      let next = Math.min(end, safeCut(text, start + limit));
      if (next < end) {
        const tail = text.slice(start, next);
        const soft = [...tail.matchAll(/[，,、：:；;\s]/g)].at(-1)?.index;
        // Avoid tiny fragments caused by a single early space in a long word.
        if (soft !== undefined && soft >= limit / 3) next = start + soft + 1;
      }
      let trimmedStart = start;
      let trimmedEnd = next;
      while (trimmedStart < trimmedEnd && /\s/.test(text[trimmedStart]!))
        trimmedStart++;
      while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1]!))
        trimmedEnd--;
      if (
        /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(
          text.slice(trimmedStart, trimmedEnd),
        )
      )
        spans.push({ start: trimmedStart, end: trimmedEnd });
      start = next;
    }
  };
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const end = sentenceEnd(text, index);
    if (end === undefined) continue;
    append(start, end);
    start = end;
    index = end - 1;
  }
  append(start, text.length);
  return spans;
}

function mapRanges(
  chapterIndex: number,
  paragraph: SpeechParagraph,
  start: number,
  end: number,
): SourceRange[] {
  return paragraph.runs.flatMap((run) => {
    const from = Math.max(start, run.textStart);
    const to = Math.min(end, run.textEnd);
    if (from >= to) return [];
    const locator = (offset: number): Locator => ({
      chapterIndex,
      paragraphIndex: paragraph.paragraphIndex,
      charOffset: run.sourceStart + offset - run.textStart,
    });
    return [{ start: locator(from), end: locator(to) }];
  });
}

/** Generator allows the caller to flush bounded batches without retaining a book. */
export function* segmentChapter(
  chapter: StoredChapter,
  revision: number,
  limit = 120,
  from?: Locator,
): Generator<SpeechSentence> {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('书籍内容版本无效。');
  for (const paragraph of extractSpeech(chapter).paragraphs) {
    for (const slice of sentenceSlices(paragraph.text, limit)) {
      let sourceRanges = mapRanges(
        chapter.index,
        paragraph,
        slice.start,
        slice.end,
      );
      if (
        from &&
        sourceRanges[0] &&
        compareLocator(sourceRanges[0].start, from) < 0
      ) {
        const contains = sourceRanges.some(
          (range) =>
            compareLocator(range.start, from) <= 0 &&
            compareLocator(range.end, from) > 0,
        );
        if (!contains) {
          const next = sourceRanges.find(
            (range) => compareLocator(range.start, from) > 0,
          );
          if (!next) continue;
          // An anchor inside removed inline code/ruby starts at the following
          // audible fragment, without dropping the rest of that sentence.
          const run = paragraph.runs.find(
            (run) =>
              run.sourceStart <= next.start.charOffset &&
              run.sourceEnd > next.start.charOffset,
          )!;
          slice.start = run.textStart + next.start.charOffset - run.sourceStart;
          while (
            slice.start < slice.end &&
            /\s/.test(paragraph.text[slice.start]!)
          )
            slice.start++;
          sourceRanges = mapRanges(
            chapter.index,
            paragraph,
            slice.start,
            slice.end,
          );
        }
      }
      const start = sourceRanges[0]?.start;
      const end = sourceRanges.at(-1)?.end;
      const spoken = paragraph.text.slice(slice.start, slice.end);
      if (
        !start ||
        !end ||
        !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(spoken)
      )
        continue;
      yield {
        id: `${chapter.bookId}:${revision}:${chapter.index}:${paragraph.paragraphIndex}:${sourceRanges.map((r) => `${r.start.charOffset}-${r.end.charOffset}`).join(',')}`,
        text: spoken,
        chapterTitle: chapter.title,
        start,
        end,
        sourceRanges,
      };
    }
  }
}

export function compareLocator(a: Locator, b: Locator) {
  return (
    a.chapterIndex - b.chapterIndex ||
    a.paragraphIndex - b.paragraphIndex ||
    a.charOffset - b.charOffset
  );
}
