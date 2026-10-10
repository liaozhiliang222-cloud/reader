import { expect, it } from 'vitest';
import { importBatch, type ImportItem } from './batch';
import type { Book } from '@/types';
const book: Book = {
  id: 'hash',
  title: '已存的书',
  type: 'txt',
  charCount: 2,
  chapterCount: 1,
  size: 6,
  importedAt: 1,
  lastReadAt: 1,
};
it('三本文件串行处理，失败后继续，并区分已有书籍', async () => {
  const files = ['a.txt', 'broken.epub', 'c.txt'].map(
    (name) => new File(['内容'], name),
  );
  const calls: string[] = [];
  const changes: ImportItem[][] = [];
  let running = 0;
  const result = await importBatch(
    files,
    async (file) => {
      running++;
      expect(running).toBe(1);
      calls.push(file.name);
      await Promise.resolve();
      running--;
      if (file.name === 'broken.epub') throw new Error('文件无法解析');
      return { book, duplicate: file.name === 'c.txt' };
    },
    (items) => changes.push(items),
  );
  expect(calls).toEqual(['a.txt', 'broken.epub', 'c.txt']);
  expect(result.map((i) => i.status)).toEqual([
    'success',
    'error',
    'duplicate',
  ]);
  expect(result[1]?.error).toBe('文件无法解析');
  expect(changes[0]?.map((i) => i.status)).toEqual([
    'waiting',
    'waiting',
    'waiting',
  ]);
  expect(changes.at(-1)).toEqual(result);
});
