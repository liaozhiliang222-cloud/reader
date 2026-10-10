import { expect, it } from 'vitest';
import { relativeRead, sortShelf, type ShelfEntry } from './model';
import type { Book } from '@/types';
const book: Book = {
  id: '1',
  title: '第10册',
  type: 'txt',
  charCount: 1,
  chapterCount: 1,
  size: 1,
  importedAt: 3,
  lastReadAt: 1,
};
it('按最近阅读/导入时间/书名排序，保留输入和对应进度', () => {
  const entries: ShelfEntry[] = [
    { book },
    {
      book: { ...book, id: '2', title: '第2册', importedAt: 2, lastReadAt: 3 },
      progress: {
        bookId: '2',
        percent: 42,
        updatedAt: 3,
        locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 },
      },
    },
    {
      book: { ...book, id: '3', title: '第1册', importedAt: 1, lastReadAt: 2 },
    },
  ];
  expect(sortShelf(entries, 'recent').map((e) => e.book.id)).toEqual([
    '2',
    '3',
    '1',
  ]);
  expect(sortShelf(entries, 'imported').map((e) => e.book.id)).toEqual([
    '1',
    '2',
    '3',
  ]);
  expect(sortShelf(entries, 'title').map((e) => e.book.id)).toEqual([
    '3',
    '2',
    '1',
  ]);
  expect(sortShelf(entries, 'recent')[0]?.progress?.percent).toBe(42);
  expect(entries.map((e) => e.book.id)).toEqual(['1', '2', '3']);
});
it('阅读时间空值与未来时钟不会显示负天数', () => {
  const now = 5 * 86400000;
  expect(relativeRead(undefined, now)).toBe('尚未阅读');
  expect(relativeRead(now + 10000, now)).toBe('今天读过');
  expect(relativeRead(now - 86400000, now)).toBe('昨天读过');
  expect(relativeRead(now - 2 * 86400000, now)).toBe('2 天前读过');
});
