import { t } from '@/i18n';
import { db } from './index';
import { assertContentRevision } from './revision';
import {
  compareHighlights,
  normalizeSpan,
  spanText,
  type TextSpan,
} from '@/reader/annotation';
import type { Highlight } from '@/types';

export async function listHighlights(bookId: string) {
  return (await db.highlights.where('bookId').equals(bookId).toArray()).sort(
    compareHighlights,
  );
}
export async function addHighlight(
  bookId: string,
  span: TextSpan,
  color: Highlight['color'],
  note?: string,
  expectedRevision = 0,
) {
  return db.transaction(
    'rw',
    db.books,
    db.chapters,
    db.highlights,
    async () => {
      const book = await db.books.get(bookId);
      const chapter = await db.chapters.get([bookId, span.chapterIndex]);
      if (!book || book.missingFile || !chapter)
        throw new Error(t('书籍内容不可用。'));
      assertContentRevision(book, expectedRevision);
      const range = normalizeSpan(chapter.paragraphs, span);
      if (!range) throw new Error(t('选区已失效，请重新选择文字。'));
      const existing = (
        await db.highlights
          .where('[bookId+chapterIndex]')
          .equals([bookId, range.chapterIndex])
          .toArray()
      ).find(
        (item) =>
          !item.unanchored &&
          item.start.paragraphIndex === range.start.paragraphIndex &&
          item.start.charOffset === range.start.charOffset &&
          item.end.paragraphIndex === range.end.paragraphIndex &&
          item.end.charOffset === range.end.charOffset,
      );
      const now = Date.now();
      const item: Highlight = {
        ...existing,
        ...range,
        id: existing?.id ?? crypto.randomUUID(),
        bookId,
        text: spanText(chapter.paragraphs, range),
        color,
        note: note === undefined ? existing?.note : note.trim() || undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await db.highlights.put(item);
      return item;
    },
  );
}
export async function updateHighlight(
  bookId: string,
  id: string,
  patch: Partial<Pick<Highlight, 'color' | 'note'>>,
) {
  return db.transaction('rw', db.highlights, async () => {
    const item = await db.highlights.get(id);
    if (!item || item.bookId !== bookId) throw new Error(t('划线不存在。'));
    const next = { ...item, ...patch, updatedAt: Date.now() };
    if ('note' in patch) next.note = patch.note?.trim() || undefined;
    await db.highlights.put(next);
    return next;
  });
}
export async function removeHighlight(bookId: string, id: string) {
  await db.transaction('rw', db.highlights, async () => {
    const item = await db.highlights.get(id);
    if (item?.bookId === bookId) await db.highlights.delete(id);
  });
}
