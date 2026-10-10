import { expect, it } from 'vitest';
import { currentSection } from './currentSection';
import type { TocEntry } from '@/parsers/epub/parse';

const locator = { chapterIndex: 2, paragraphIndex: 12, charOffset: 7 };
const toc: TocEntry[] = [
  { title: '作品', chapterIndex: 2, paragraphIndex: 0, level: 0 },
  { title: '第一节', chapterIndex: 2, paragraphIndex: 0, level: 1 },
  { title: '较后的小节', chapterIndex: 2, paragraphIndex: 20, level: 1 },
  { title: '当前小节', chapterIndex: 2, paragraphIndex: 10, level: 1 },
  { title: '更早的重排项', chapterIndex: 2, paragraphIndex: 5, level: 1 },
  { title: '别章', chapterIndex: 3, paragraphIndex: 12, level: 5 },
];

it('按原文位置选择当前目录小节，忽略别章、未来小节及目录中的位置重排', () => {
  expect(currentSection(toc, locator)?.title).toBe('当前小节');
  expect(currentSection(toc, { ...locator, paragraphIndex: 20 })?.title).toBe(
    '较后的小节',
  );
});

it('父子目录共用片段时选择子节；没有对应前置目录时返回空供章节名兜底', () => {
  expect(currentSection(toc, { ...locator, paragraphIndex: 0 })?.title).toBe(
    '第一节',
  );
  expect(
    currentSection([...toc, toc[0]!], { ...locator, paragraphIndex: 0 })?.title,
  ).toBe('第一节');
  expect(currentSection(undefined, locator)).toBeUndefined();
  expect(currentSection(toc, { ...locator, chapterIndex: 1 })).toBeUndefined();
  expect(
    currentSection([toc[3]!], { ...locator, paragraphIndex: 0 }),
  ).toBeUndefined();
});
