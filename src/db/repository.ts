import { t } from '@/i18n';
import { sourceFingerprint } from './identity';
import { db } from './index';
import { contentRevision } from './revision';
import type { Book, ChapterSummary, Progress } from '@/types';
import type { TextChapter } from '@/parsers/txt/chapters';
const summarize = (
  chapters: (TextChapter & { level?: number })[],
): ChapterSummary[] =>
  chapters.map(({ index, title, charStart, charCount, level }) => ({
    index,
    title,
    charStart,
    charCount,
    level,
  }));

export async function saveBook(
  book: Book,
  chapters: TextChapter[],
  original: Blob,
  assets: { id: string; data: Blob }[] = [],
) {
  return db.transaction(
    'rw',
    db.books,
    db.chapters,
    db.blobs,
    db.speech,
    async () => {
      const existing = await db.books.get(book.id);
      if (existing && !existing.missingFile) return false;
      await db.speech.delete(book.id);
      if (
        existing?.type === 'md' &&
        existing.markdownVersion !== book.markdownVersion
      )
        throw new Error(t('Markdown 段落结构版本不同，未修改现有笔记。'));
      if (
        existing?.type === 'epub' &&
        (existing.parserVersion ?? 1) !== (book.parserVersion ?? 1)
      )
        throw new Error(
          t('补导期间书籍的段落结构发生变化，请重新导入，未修改现有笔记。'),
        );
      await db.books.put({
        ...book,
        ...existing,
        sourceFingerprint: sourceFingerprint(book),
        identityVersion: 1,
        chapterCount: book.chapterCount,
        charCount: book.charCount,
        size: book.size,
        coverBlobId: book.coverBlobId,
        toc: book.toc,
        chapterSummaries: summarize(chapters),
        encoding: book.encoding,
        parserVersion: book.parserVersion,
        markdownVersion: book.markdownVersion,
        missingFile: false,
        fileBlobId: book.fileBlobId ?? book.id,
      });
      await db.chapters.where('bookId').equals(book.id).delete();
      await db.chapters.bulkAdd(
        chapters.map((c) => ({ ...c, bookId: book.id })),
      );
      await db.blobs.put({ id: book.fileBlobId ?? book.id, data: original });
      await db.blobs.bulkPut(assets);
      return true;
    },
  );
}
export const listBooks = () =>
  db.books.orderBy('lastReadAt').reverse().toArray();
export const getBook = (id: string) => db.books.get(id);
export const getBlob = (id: string) => db.blobs.get(id);
export const getChapter = (id: string, index: number) =>
  db.chapters.get([id, index]);
export const getProgress = (id: string) => db.progress.get(id);
export async function saveProgress(progress: Progress, expectedRevision = 0) {
  await db.transaction('rw', db.books, db.progress, db.speech, async () => {
    const book = await db.books.get(progress.bookId);
    // 旧阅读页的 debounce/pagehide/unmount 不得覆盖重解析后的锚点。
    if (!book || contentRevision(book) !== expectedRevision) return;
    if ((await db.speech.get(progress.bookId))?.owner === 'speech') return;
    await db.progress.put(progress);
    await db.books.update(progress.bookId, { lastReadAt: progress.updatedAt });
  });
}

async function deleteBookRecords(book: Book, keepNotes = false) {
  await db.books.delete(book.id);
  await db.chapters.where('bookId').equals(book.id).delete();
  await db.progress.delete(book.id);
  await db.speech.delete(book.id);
  await db.bookmarks.where('bookId').equals(book.id).delete();
  if (!keepNotes) await db.highlights.where('bookId').equals(book.id).delete();
  const ids = [
    book.fileBlobId ?? book.id,
    book.draftBlobId,
    book.coverBlobId,
  ].filter((id): id is string => !!id);
  await db.blobs.bulkDelete(ids);
  await db.blobs
    .where('id')
    .startsWith(book.id + ':')
    .delete();
}

export async function saveDraft(
  book: Book,
  chapters: TextChapter[],
  source: string,
  editingId?: string,
) {
  return db.transaction(
    'rw',
    [
      db.books,
      db.chapters,
      db.blobs,
      db.progress,
      db.bookmarks,
      db.highlights,
      db.settings,
      db.speech,
    ],
    async () => {
      const previous = editingId ? await db.books.get(editingId) : undefined;
      if (editingId && (!previous || previous.type !== 'paste'))
        throw new Error(t('文稿已不存在，请返回书架重新打开。'));
      const existing = await db.books.get(book.id);
      if (
        existing?.draftFormat === 'markdown' &&
        existing.markdownVersion !== book.markdownVersion
      )
        throw new Error(t('Markdown 段落结构版本不同，未修改现有笔记。'));
      if (existing && !existing.missingFile) {
        if (!editingId) return { book: existing, duplicate: true };
        if (editingId !== book.id)
          throw new Error(
            t('相同正文的文稿已在书架中，请使用该文稿或修改正文。'),
          );
        await db.books.update(book.id, { title: book.title });
        return { book: { ...existing, title: book.title }, duplicate: false };
      }
      if (previous) await deleteBookRecords(previous);
      await db.speech.delete(book.id);
      const draft: Book = {
        ...book,
        ...existing,
        sourceFingerprint: sourceFingerprint(book),
        identityVersion: 1,
        title:
          existing?.missingFile && !editingId ? existing.title : book.title,
        type: 'paste',
        draftFormat: book.draftFormat,
        markdownVersion: book.markdownVersion,
        fileBlobId: undefined,
        draftBlobId: book.id + ':draft',
        chapterSummaries: summarize(chapters),
        missingFile: false,
        importedAt:
          previous?.importedAt ?? existing?.importedAt ?? book.importedAt,
        size: book.size,
        charCount: book.charCount,
        chapterCount: book.chapterCount,
        toc: book.toc,
        settingsOverride:
          previous?.settingsOverride ??
          existing?.settingsOverride ??
          book.settingsOverride,
      };
      await db.books.put(draft);
      await db.chapters.where('bookId').equals(book.id).delete();
      await db.chapters.bulkAdd(
        chapters.map((c) => ({ ...c, bookId: book.id })),
      );
      await db.blobs.put({
        id: draft.draftBlobId!,
        data: new Blob([source], { type: 'text/plain;charset=utf-8' }),
      });
      const global = await db.settings.get('global');
      if (previous && global?.value.lastBookId === previous.id)
        await db.settings.put({
          ...global,
          value: { ...global.value, lastBookId: book.id },
        });
      return { book: draft, duplicate: false };
    },
  );
}

export const getDraft = async (book: Book) => {
  if (book.type !== 'paste' || !book.draftBlobId)
    throw new Error(t('这本文稿没有可编辑的正文。'));
  const blob = await db.blobs.get(book.draftBlobId);
  if (!blob) throw new Error(t('文稿正文已不存在，请从备份恢复。'));
  return blob.data.text();
};
export async function countAnnotations(bookId: string) {
  const [bookmarks, highlights] = await Promise.all([
    db.bookmarks.where('bookId').equals(bookId).count(),
    db.highlights.where('bookId').equals(bookId).count(),
  ]);
  return { bookmarks, highlights };
}

export async function listShelf() {
  return db.transaction('r', db.books, db.progress, async () => {
    // 批量请求避免 WebKit 逐条游标的跨进程往返；每批最多32本，
    // 立即丢弃目录字段，书架仅保留轻量投影。正文从不在此读取。
    const loadBooks = async () => {
      const books: Book[] = [];
      let after: string | undefined;
      const batchSize = 32;
      while (true) {
        const batch: Book[] = await (
          after === undefined
            ? db.books.toCollection()
            : db.books.where('id').above(after)
        )
          .limit(batchSize)
          .toArray();
        for (const book of batch) {
          const light = { ...book };
          delete light.chapterSummaries;
          delete light.toc;
          books.push(light);
        }
        if (batch.length < batchSize) return books;
        after = batch[batch.length - 1]!.id;
      }
    };
    const [books, progress] = await Promise.all([
      loadBooks(),
      db.progress.toArray(),
    ]);
    const positions = new Map(progress.map((p) => [p.bookId, p]));
    return books.map((book) => ({ book, progress: positions.get(book.id) }));
  });
}
export async function renameBook(id: string, title: string) {
  const value = title.trim();
  if (!value || [...value].length > 200)
    throw new Error(t('请输入 1 至 200 字的书名。'));
  if (!(await db.books.update(id, { title: value })))
    throw new Error(t('这本书已不存在。'));
}
export async function deleteBook(id: string, keepNotes = false) {
  await db.transaction(
    'rw',
    [
      db.books,
      db.chapters,
      db.blobs,
      db.progress,
      db.bookmarks,
      db.highlights,
      db.settings,
      db.speech,
    ],
    async () => {
      const book = await db.books.get(id);
      if (!book) return;
      if (keepNotes)
        await db.highlights
          .where('bookId')
          .equals(id)
          .modify((item) => {
            item.archivedSource = {
              title: book.title,
              chapterTitle:
                book.chapterSummaries?.find(
                  (chapter) => chapter.index === item.chapterIndex,
                )?.title ?? t('第 {0} 节', item.chapterIndex + 1),
            };
            item.unanchored = true;
            item.updatedAt = Date.now();
          });
      await deleteBookRecords(book, keepNotes);
      const global = await db.settings.get('global');
      if (global?.value.lastBookId === id)
        await db.settings.put({
          ...global,
          value: { ...global.value, lastBookId: undefined },
        });
    },
  );
}

export async function getChapterSummaries(
  id: string,
): Promise<ChapterSummary[]> {
  return db.transaction('rw', db.books, db.chapters, async () => {
    const book = await db.books.get(id);
    if (!book) throw new Error(t('书籍不存在。'));
    if (book.chapterSummaries) return book.chapterSummaries;
    const summaries: ChapterSummary[] = [];
    // 兼容旧记录：逐章读取，只保留摘要，避免聚集整本正文。
    await db.chapters
      .where('bookId')
      .equals(id)
      .each((chapter) => {
        summaries.push(...summarize([chapter]));
      });
    summaries.sort((a, b) => a.index - b.index);
    await db.books.update(id, { chapterSummaries: summaries });
    return summaries;
  });
}
