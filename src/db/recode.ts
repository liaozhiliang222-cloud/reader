import { t } from '@/i18n';
import { db } from './index';
import { assertContentRevision, contentRevision } from './revision';
import {
  chapterAtPercent,
  locatorAtOffset,
  percentOf,
} from '@/reader/position';
import type { ReparsedText } from '@/parsers/recodeText';
import type { Book } from '@/types';

/** 替换派生内容与进度；原文件、书籍身份与笔记原文始终保留。 */
export async function applyEncoding(
  source: Book,
  parsed: ReparsedText,
  percent: number,
  database = db,
): Promise<Book> {
  if (
    source.type !== 'txt' ||
    source.id !== parsed.id ||
    !parsed.chapters.length
  )
    throw new Error(t('重解析内容与原书不一致，未修改书籍。'));
  const { chapters, charCount } = parsed;
  const target = chapterAtPercent(chapters, charCount, percent)!;
  const chapter = chapters.find((item) => item.index === target.chapter.index)!;
  const locator = locatorAtOffset(chapter, target.offset);
  return database.transaction(
    'rw',
    [
      database.books,
      database.chapters,
      database.progress,
      database.blobs,
      database.bookmarks,
      database.highlights,
      database.speech,
    ],
    async () => {
      const current = await database.books.get(source.id);
      if (!current || current.type !== 'txt' || current.missingFile)
        throw new Error(t('书籍已不可用，未修改本地数据。'));
      assertContentRevision(current, contentRevision(source));
      await database.speech.delete(source.id);
      if (!(await database.blobs.get(current.fileBlobId ?? current.id)))
        throw new Error(t('原文件已不可用，未修改书籍。'));
      // 仅完整章节文本和标题均未改变时保留定位，避免把旧笔记画到相似短句上。
      const unchanged = new Map<number, boolean>();
      const chapterUnchanged = async (index: number) => {
        if (!unchanged.has(index)) {
          const old = await database.chapters.get([source.id, index]);
          const next = chapters[index];
          unchanged.set(
            index,
            !!old &&
              !!next &&
              old.title === next.title &&
              old.paragraphs.length === next.paragraphs.length &&
              old.paragraphs.every((text, i) => text === next.paragraphs[i]),
          );
        }
        return unchanged.get(index)!;
      };
      const bookmarks = await database.bookmarks
        .where('bookId')
        .equals(source.id)
        .toArray();
      for (const item of bookmarks)
        if (
          !item.unanchored &&
          !(await chapterUnchanged(item.locator.chapterIndex))
        )
          await database.bookmarks.update(item.id, { unanchored: true });
      const highlights = await database.highlights
        .where('bookId')
        .equals(source.id)
        .toArray();
      for (const item of highlights)
        if (!item.unanchored && !(await chapterUnchanged(item.chapterIndex)))
          await database.highlights.update(item.id, {
            unanchored: true,
            updatedAt: Date.now(),
          });
      await database.chapters.where('bookId').equals(source.id).delete();
      await database.chapters.bulkAdd(
        chapters.map((item) => ({ ...item, bookId: source.id })),
      );
      const now = Date.now();
      const updated: Book = {
        ...current,
        encoding: parsed.encoding,
        contentRevision: contentRevision(current) + 1,
        chapterCount: chapters.length,
        chapterSummaries: chapters.map(
          ({ index, title, charStart, charCount }) => ({
            index,
            title,
            charStart,
            charCount,
          }),
        ),
        charCount,
        lastReadAt: now,
      };
      await database.books.put(updated);
      await database.progress.put({
        bookId: source.id,
        locator,
        percent: percentOf(chapter, locator, charCount),
        updatedAt: now,
      });
      return updated;
    },
  );
}
