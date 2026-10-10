import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { createDatabase } from './schema';

it('M0 v1 升级到正式 v2 保留书籍、原文件、章节和进度', async () => {
  const name = 'migration-' + crypto.randomUUID();
  const old = new Dexie(name);
  old.version(1).stores({
    books: 'id,lastReadAt,importedAt',
    chapters: '[bookId+index],bookId',
    progress: 'bookId',
    blobs: 'id',
  });
  await old.table('books').put({
    id: 'book',
    type: 'txt',
    title: '旧书',
    importedAt: 1,
    lastReadAt: 2,
  });
  const locator = { chapterIndex: 2, paragraphIndex: 3, charOffset: 17 };
  await old
    .table('progress')
    .put({ bookId: 'book', locator, percent: 42, updatedAt: 2 });
  await old
    .table('chapters')
    .put({ bookId: 'book', index: 2, paragraphs: ['旧正文'] });
  await old.table('blobs').put({ id: 'book', data: new Blob(['旧正文']) });
  old.close();
  const upgraded = createDatabase(name);
  try {
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    expect((await upgraded.books.get('book'))?.fileBlobId).toBe('book');
    expect((await upgraded.progress.get('book'))?.locator).toEqual(locator);
    expect((await upgraded.chapters.get(['book', 2]))?.paragraphs).toEqual([
      '旧正文',
    ]);
    expect((await upgraded.blobs.get('book'))?.data.size).toBe(9);
    expect(upgraded.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'books',
        'chapters',
        'blobs',
        'progress',
        'bookmarks',
        'highlights',
        'settings',
      ]),
    );
  } finally {
    await upgraded.delete();
  }
});
