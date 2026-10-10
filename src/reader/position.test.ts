import { expect, it } from 'vitest';
import {
  chapterAtPercent,
  clampLocator,
  locatorAtOffset,
  locatorOffset,
  percentOf,
} from './position';
import type { TextChapter } from '@/parsers/txt/chapters';
const chapter: TextChapter = {
  index: 2,
  title: '第三章',
  paragraphs: ['甲乙', '丙😀丁', '戊'],
  charStart: 10,
  charCount: 7,
};
it('段落与章节全局偏移双向转换，段落边界与代理对安全', () => {
  expect(locatorAtOffset(chapter, 2)).toEqual({
    chapterIndex: 2,
    paragraphIndex: 1,
    charOffset: 0,
  });
  expect(
    locatorOffset(chapter, {
      chapterIndex: 2,
      paragraphIndex: 1,
      charOffset: 3,
    }),
  ).toBe(5);
  expect(locatorAtOffset(chapter, 4)).toEqual({
    chapterIndex: 2,
    paragraphIndex: 1,
    charOffset: 1,
  });
  expect(locatorAtOffset(chapter, 99)).toEqual({
    chapterIndex: 2,
    paragraphIndex: 2,
    charOffset: 1,
  });
  expect(
    clampLocator(chapter, {
      chapterIndex: 999,
      paragraphIndex: -8,
      charOffset: Infinity,
    }),
  ).toEqual({ chapterIndex: 2, paragraphIndex: 0, charOffset: 0 });
  expect(
    percentOf(
      chapter,
      { chapterIndex: 2, paragraphIndex: 1, charOffset: 3 },
      20,
    ),
  ).toBe(75);
});
it('50%精确选章和章内偏移，边界进入下一章；100%定位最后内容', () => {
  const summaries = [
    { index: 0, title: '甲', charStart: 0, charCount: 10 },
    { index: 1, title: '空', charStart: 10, charCount: 0 },
    { index: 2, title: '乙', charStart: 10, charCount: 30 },
  ];
  expect(chapterAtPercent(summaries, 40, 50)).toEqual({
    chapter: summaries[2],
    offset: 10,
  });
  expect(chapterAtPercent(summaries, 40, 25)?.chapter.index).toBe(2);
  expect(chapterAtPercent(summaries, 40, 100)?.offset).toBe(30);
  expect(chapterAtPercent(summaries, 40, -1)?.chapter.index).toBe(0);
  expect(chapterAtPercent([], 40, 50)).toBeUndefined();
});
it('只有图片或空段落时提供有效锚点，零字数按章节比例选择', () => {
  const image = { ...chapter, charCount: 0, paragraphs: ['', ''] };
  expect(locatorAtOffset(image, 0)).toEqual({
    chapterIndex: 2,
    paragraphIndex: 0,
    charOffset: 0,
  });
  expect(
    clampLocator(
      { ...image, paragraphs: [] },
      { chapterIndex: 2, paragraphIndex: 9, charOffset: 9 },
    ),
  ).toEqual({ chapterIndex: 2, paragraphIndex: 0, charOffset: 0 });
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    index,
    title: String(index),
    charStart: 0,
    charCount: 0,
  }));
  expect(chapterAtPercent(chapters, 0, 50)?.chapter.index).toBe(5);
  expect(chapterAtPercent(chapters, 0, 100)?.chapter.index).toBe(9);
});
