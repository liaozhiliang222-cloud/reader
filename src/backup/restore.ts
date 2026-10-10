import { db } from '@/db';
import Dexie from 'dexie';
import { RESTORE_PREFIX, type PreparedSource } from './staging';
import { initialSettings } from '@/app/settings';
import { clampLocator } from '@/reader/position';
import { normalizeSpan, spanText } from '@/reader/annotation';
import { sameLocator } from '@/db/bookmarks';
import { validateBackup } from './validate';
import { newest } from './merge';
import type { BackupPayload, PreparedBook } from './types';
import type { Book, Locator, StoredChapter } from '@/types';

async function localContent(
  book: Book,
  database: typeof db,
): Promise<PreparedBook | undefined> {
  if (book.missingFile) return;
  const chapters = await database.chapters
    .where('bookId')
    .equals(book.id)
    .sortBy('index');
  if (!chapters.length || chapters.length !== book.chapterCount) return;
  const blobs = await database.blobs
    .where('id')
    .startsWith(book.id + ':')
    .toArray();
  const ids = [
    book.fileBlobId ?? book.id,
    book.draftBlobId,
    book.coverBlobId,
  ].filter((id): id is string => !!id);
  for (const id of ids) {
    const blob = await database.blobs.get(id);
    if (blob && !blobs.some((b) => b.id === id)) blobs.push(blob);
  }
  return { book, chapters, blobs };
}
function checkPosition(chapters: StoredChapter[], where: Locator) {
  const chapter = chapters.find(
    (chapter) => chapter.index === where.chapterIndex,
  );
  if (!chapter || !sameLocator(clampLocator(chapter, where), where))
    throw new Error('备份中的位置与原文不一致，未修改本地数据。');
  return chapter;
}
export async function restoreBackup(
  payload: Pick<BackupPayload, 'backup'>,
  prepared: PreparedBook[] | PreparedSource,
  mode: 'merge' | 'overwrite',
  database = db,
  signal?: AbortSignal,
) {
  const backup = validateBackup(payload.backup);
  signal?.throwIfAborted();
  const source: PreparedSource = Array.isArray(prepared)
    ? {
        ids: prepared.map((item) => item.book.id),
        get: async (id) => prepared.find((item) => item.book.id === id),
      }
    : prepared;
  const preparedIds = new Set(source.ids);
  const bookIds = new Set(backup.books.map((book) => book.id));
  if (
    preparedIds.size !== source.ids.length ||
    source.ids.some((id) => !bookIds.has(id))
  )
    throw new Error('恢复内容与备份书架不一致。');
  if (backup.files.some((file) => !preparedIds.has(file.bookId)))
    throw new Error('原文件尚未验证，不能恢复。');
  const group = <T extends { bookId: string }>(rows: T[]) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const list = groups.get(row.bookId) ?? [];
      list.push(row);
      groups.set(row.bookId, list);
    }
    return groups;
  };
  const progressByBook = group(backup.progress),
    bookmarksByBook = group(backup.bookmarks),
    highlightsByBook = group(backup.highlights);
  return database.transaction('rw', database.tables, async () => {
    const transaction = Dexie.currentTransaction!;
    const abort = () => transaction.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const existing = new Map(
        (await database.books.toArray()).map((book) => [book.id, book]),
      );
      const global = await database.settings.get('global');
      const incomingBooks: Book[] = [];
      const keepBlobs = new Set<string>();
      if (mode === 'overwrite') {
        // Keep original chapters/blobs available for light backups until every book
        // is checked; all writes and cleanup below remain one atomic transaction.
        await database.books.clear();
        await database.progress.clear();
        await database.bookmarks.clear();
        await database.highlights.clear();
        await database.settings.clear();
      }
      for (const meta of backup.books) {
        const local = existing.get(meta.id);
        if (local && local.type !== meta.type)
          throw new Error('相同指纹的书籍类型冲突，未修改本地数据。');
        if (
          local &&
          (local.markdownVersion !== meta.markdownVersion ||
            local.draftFormat !== meta.draftFormat) &&
          (mode === 'merge' || !preparedIds.has(meta.id))
        )
          throw new Error('Markdown 段落结构版本不同，未修改本地数据。');
        if (
          local?.type === 'epub' &&
          (local.parserVersion ?? 1) !== (meta.parserVersion ?? 1) &&
          (mode === 'merge' || !preparedIds.has(meta.id))
        )
          throw new Error(
            `《${meta.title}》的段落结构版本不同，无法安全合并。请先备份本机数据，再使用完整备份覆盖恢复。`,
          );
        const localData =
          local && (mode === 'merge' || !preparedIds.has(meta.id))
            ? await localContent(local, database)
            : undefined;
        const content =
          localData ??
          (preparedIds.has(meta.id) ? await source.get(meta.id) : undefined);
        if (!content && preparedIds.has(meta.id))
          throw new Error('恢复暂存已丢失，请重新选择备份。');
        signal?.throwIfAborted();
        const originalFields = content
          ? {
              fileBlobId: content.book.fileBlobId,
              draftBlobId: content.book.draftBlobId,
              coverBlobId: content.book.coverBlobId,
              toc: content.book.toc,
              chapterSummaries: content.book.chapterSummaries,
              encoding: content.book.encoding,
              parserVersion: content.book.parserVersion,
              markdownVersion: content.book.markdownVersion,
              draftFormat: content.book.draftFormat,
              chapterCount: content.book.chapterCount,
              charCount: content.book.charCount,
            }
          : {};
        incomingBooks.push({
          ...meta,
          ...(mode === 'merge' && local ? local : {}),
          ...originalFields,
          missingFile: !content,
          importedAt:
            mode === 'merge' && local
              ? Math.min(local.importedAt, meta.importedAt)
              : meta.importedAt,
          lastReadAt: Math.max(
            meta.lastReadAt,
            mode === 'merge' ? (local?.lastReadAt ?? 0) : 0,
          ),
        });
        for (const progress of progressByBook.get(meta.id) ?? []) {
          if (content) checkPosition(content.chapters, progress.locator);
        }
        for (const bookmark of bookmarksByBook.get(meta.id) ?? []) {
          if (content && !bookmark.unanchored)
            checkPosition(content.chapters, bookmark.locator);
        }
        for (const highlight of highlightsByBook.get(meta.id) ?? []) {
          if (!content || highlight.unanchored) continue;
          const chapter = checkPosition(content.chapters, {
            chapterIndex: highlight.chapterIndex,
            ...highlight.start,
          });
          checkPosition(content.chapters, {
            chapterIndex: highlight.chapterIndex,
            ...highlight.end,
          });
          const normalized = normalizeSpan(chapter.paragraphs, highlight);
          if (
            !normalized ||
            normalized.start.charOffset !== highlight.start.charOffset ||
            normalized.end.charOffset !== highlight.end.charOffset ||
            spanText(chapter.paragraphs, normalized) !== highlight.text
          )
            throw new Error('划线范围或摘录与原文不一致，未修改本地数据。');
        }
        await database.books.put(incomingBooks[incomingBooks.length - 1]!);
        if (content) {
          for (const blob of content.blobs) keepBlobs.add(blob.id);
          if (!localData) {
            await database.chapters.where('bookId').equals(meta.id).delete();
            await database.chapters.bulkPut(content.chapters);
            await database.blobs.bulkPut(content.blobs);
          }
        } else if (mode === 'overwrite') {
          await database.chapters.where('bookId').equals(meta.id).delete();
        }
      }
      if (mode === 'overwrite') {
        const chapterBooks = await database.chapters
          .orderBy('bookId')
          .uniqueKeys();
        for (const id of chapterBooks)
          if (!bookIds.has(String(id)))
            await database.chapters.where('bookId').equals(id).delete();
        const obsolete = (
          await database.blobs.toCollection().primaryKeys()
        ).filter(
          (id) =>
            !keepBlobs.has(id) &&
            !id.startsWith('incoming:') &&
            !id.startsWith(RESTORE_PREFIX),
        );
        for (let offset = 0; offset < obsolete.length; offset += 256)
          await database.blobs.bulkDelete(obsolete.slice(offset, offset + 256));
      }
      for (const progress of backup.progress) {
        const local = await database.progress.get(progress.bookId);
        await database.progress.put(
          newest(local, progress, (record) => record.updatedAt),
        );
      }
      for (const bookmark of backup.bookmarks) {
        const local = await database.bookmarks.get(bookmark.id);
        await database.bookmarks.put(
          newest(local, bookmark, (record) => record.createdAt),
        );
      }
      for (const highlight of backup.highlights) {
        const local = await database.highlights.get(highlight.id);
        await database.highlights.put(
          newest(local, highlight, (record) => record.updatedAt),
        );
      }
      for (const book of incomingBooks) {
        const progress = await database.progress.get(book.id);
        if (progress && progress.updatedAt > book.lastReadAt)
          await database.books.update(book.id, {
            lastReadAt: progress.updatedAt,
          });
      }
      const value = mode === 'merge' && global ? global.value : backup.settings;
      const settings = {
        ...initialSettings(),
        ...value,
        reading: { ...initialSettings().reading, ...value.reading },
      };
      if (
        settings.lastBookId &&
        !(await database.books.get(settings.lastBookId))
      )
        settings.lastBookId = undefined;
      await database.settings.put({ id: 'global', value: settings });
      signal?.throwIfAborted();
      return {
        settings,
        books: await database.books.count(),
        missing: await database.books
          .filter((book) => !!book.missingFile)
          .count(),
      };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  });
}
