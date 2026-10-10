import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { db } from './index';
import { addBookmark, listBookmarks, removeBookmark } from './bookmarks';
afterEach(async () => {
  await db.delete();
});
it('并发添加同一锚点去重，按位置排序，不误删除其他书籍的书签', async () => {
  await db.books.add({
    id: 'b',
    title: '书',
    type: 'txt',
    charCount: 200,
    chapterCount: 2,
    importedAt: 1,
    lastReadAt: 1,
    size: 1,
  });
  const data = {
    bookId: 'b',
    locator: { chapterIndex: 1, paragraphIndex: 0, charOffset: 0 },
    chapterTitle: '后章',
    excerpt: '😀'.repeat(100),
  };
  const [first, duplicate] = await Promise.all([
    addBookmark(data),
    addBookmark(data),
  ]);
  expect(first.id).toBe(duplicate.id);
  expect([...first.excerpt]).toHaveLength(50);
  const earlier = await addBookmark({
    ...data,
    locator: { chapterIndex: 0, paragraphIndex: 1, charOffset: 2 },
    chapterTitle: '前章',
  });
  expect((await listBookmarks('b')).map((b) => b.id)).toEqual([
    earlier.id,
    first.id,
  ]);
  await removeBookmark('other', first.id);
  expect(await db.bookmarks.count()).toBe(2);
  await removeBookmark('b', first.id);
  expect(await db.bookmarks.count()).toBe(1);
  await expect(addBookmark({ ...data, bookId: 'missing' })).rejects.toThrow(
    '不可用',
  );
});
