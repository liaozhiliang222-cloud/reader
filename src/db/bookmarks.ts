import { t } from '@/i18n';
import { db } from './index';
import { assertContentRevision } from './revision';
import type { Bookmark, Locator } from '@/types';
export function sameLocator(a: Locator, b: Locator) {
  return (
    a.chapterIndex === b.chapterIndex &&
    a.paragraphIndex === b.paragraphIndex &&
    a.charOffset === b.charOffset
  );
}
export async function listBookmarks(bookId: string) {
  const items = await db.bookmarks.where('bookId').equals(bookId).toArray();
  return items.sort(
    (a, b) =>
      a.locator.chapterIndex - b.locator.chapterIndex ||
      a.locator.paragraphIndex - b.locator.paragraphIndex ||
      a.locator.charOffset - b.locator.charOffset ||
      a.createdAt - b.createdAt,
  );
}
export async function addBookmark(
  data: Omit<Bookmark, 'id' | 'createdAt'>,
  expectedRevision = 0,
) {
  return db.transaction('rw', db.books, db.bookmarks, async () => {
    const book = await db.books.get(data.bookId);
    if (!book || book.missingFile) throw new Error(t('书籍内容不可用。'));
    assertContentRevision(book, expectedRevision);
    const existing = (
      await db.bookmarks.where('bookId').equals(data.bookId).toArray()
    ).find(
      (bookmark) =>
        !bookmark.unanchored && sameLocator(bookmark.locator, data.locator),
    );
    if (existing) return existing;
    const bookmark: Bookmark = {
      ...data,
      id: crypto.randomUUID(),
      excerpt: [...data.excerpt].slice(0, 50).join(''),
      createdAt: Date.now(),
    };
    await db.bookmarks.add(bookmark);
    return bookmark;
  });
}
export async function removeBookmark(bookId: string, id: string) {
  await db.transaction('rw', db.bookmarks, async () => {
    const item = await db.bookmarks.get(id);
    if (item?.bookId === bookId) await db.bookmarks.delete(id);
  });
}
