import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './index';
import {
  saveBook,
  getBook,
  getChapter,
  getProgress,
  saveProgress,
  listBooks,
  saveDraft,
  getDraft,
  listShelf,
  renameBook,
  deleteBook,
  getChapterSummaries,
} from './repository';
import { initialSettings } from '@/app/settings';
import { splitChapters } from '@/parsers/txt/chapters';
import type { Book } from '@/types';

const book: Book = {
  id: 'test',
  title: '测试书',
  type: 'txt',
  encoding: 'utf-8',
  charCount: 2,
  chapterCount: 1,
  importedAt: 1,
  lastReadAt: 1,
  size: 6,
};
beforeEach(async () => {
  await db.open();
});

it('EPUB补导在事务内再次检查解析规则，不能覆盖并发恢复的新版本占位记录', async () => {
  const placeholder: Book = {
    ...book,
    type: 'epub',
    missingFile: true,
    parserVersion: 2,
  };
  await db.books.put(placeholder);
  await expect(
    saveBook(
      { ...placeholder, parserVersion: 1 },
      splitChapters('旧正文'),
      new Blob(['source']),
    ),
  ).rejects.toThrow('段落结构发生变化');
  expect(await getBook(book.id)).toEqual(placeholder);
  expect(await db.chapters.count()).toBe(0);
  expect(await db.blobs.count()).toBe(0);
});

it('百本千章书架只返回轻量元数据与进度，不修改完整书籍记录', async () => {
  const summaries = Array.from({ length: 1000 }, (_, index) => ({
    index,
    title: '第' + index + '章',
    charStart: index * 100,
    charCount: 100,
  }));
  const books = Array.from({ length: 100 }, (_, index) => ({
    ...book,
    id: 'shelf-' + index,
    chapterCount: 1000,
    chapterSummaries: summaries,
    toc: summaries.map((c) => ({
      title: c.title,
      chapterIndex: c.index,
      paragraphIndex: 0,
      level: 0,
    })),
    coverBlobId: 'cover-' + index,
    settingsOverride: { fontSize: 24 },
  }));
  await db.books.bulkPut(books);
  await db.progress.put({
    bookId: books[99]!.id,
    locator: { chapterIndex: 999, paragraphIndex: 0, charOffset: 50 },
    percent: 99.9,
    updatedAt: 10,
  });
  const entries = await listShelf();
  expect(entries).toHaveLength(100);
  expect(entries.map(({ book }) => book.id).sort()).toEqual(
    books.map((book) => book.id).sort(),
  );
  expect(entries.every(({ book }) => !book.toc && !book.chapterSummaries)).toBe(
    true,
  );
  expect(entries.find(({ book }) => book.id === 'shelf-99')).toMatchObject({
    book: { coverBlobId: 'cover-99', settingsOverride: { fontSize: 24 } },
    progress: { percent: 99.9 },
  });
  expect((await getBook('shelf-99'))?.chapterSummaries).toHaveLength(1000);
  expect((await getBook('shelf-99'))?.toc).toHaveLength(1000);
});

it.each([0, 64])(
  '书架含%d本时读完全部批次，保留每本的进度关联',
  async (count) => {
    const books = Array.from({ length: count }, (_, index) => ({
      ...book,
      id: `batch-${String(index).padStart(3, '0')}`,
    }));
    const progress = books.map((book, index) => ({
      bookId: book.id,
      locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
      percent: index,
      updatedAt: index + 1,
    }));
    await db.books.bulkPut(books);
    await db.progress.bulkPut(progress);
    const entries = await listShelf();
    expect(entries).toEqual(
      books.map((book, index) => ({ book, progress: progress[index] })),
    );
  },
);

describe('文稿编辑与重复导入', () => {
  const draft: Book = {
    ...book,
    id: 'paste:old',
    type: 'paste',
    title: '文稿',
  };
  const chapters = splitChapters('甲乙');
  const progress = {
    bookId: draft.id,
    locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
    percent: 50,
    updatedAt: 2,
  };
  const annotate = async () => {
    await saveProgress(progress);
    await db.bookmarks.add({
      id: 'bookmark',
      bookId: draft.id,
      locator: progress.locator,
      chapterTitle: '一',
      excerpt: '甲',
      createdAt: 2,
    });
    await db.highlights.add({
      id: 'highlight',
      bookId: draft.id,
      chapterIndex: 0,
      start: { paragraphIndex: 0, charOffset: 0 },
      end: { paragraphIndex: 0, charOffset: 1 },
      text: '甲',
      color: 'red',
      note: '记录',
      createdAt: 2,
      updatedAt: 2,
    });
  };
  it('原正文单独存储，重复导入与只改标题保留进度及标注', async () => {
    const first = await saveDraft(draft, chapters, '甲乙');
    expect(first.book.fileBlobId).toBeUndefined();
    expect(await getDraft(first.book)).toBe('甲乙');
    await annotate();
    expect(
      (await saveDraft({ ...draft, title: '另一个标题' }, chapters, '甲乙'))
        .duplicate,
    ).toBe(true);
    expect((await getBook(draft.id))?.title).toBe('文稿');
    await saveDraft({ ...draft, title: '新标题' }, chapters, '甲乙', draft.id);
    expect((await getBook(draft.id))?.title).toBe('新标题');
    expect(await getProgress(draft.id)).toEqual(progress);
    expect(await db.highlights.count()).toBe(1);
    expect(await db.bookmarks.count()).toBe(1);
  });
  it('修改正文原子替换ID与章节，重置旧锚点并保留排版、导入时间', async () => {
    await saveDraft(
      { ...draft, settingsOverride: { fontSize: 24 } },
      chapters,
      '甲乙',
    );
    await annotate();
    const updated = await saveDraft(
      { ...draft, id: 'paste:new', title: '新文稿', importedAt: 99 },
      splitChapters('丙丁'),
      '丙丁',
      draft.id,
    );
    expect(await getBook(draft.id)).toBeUndefined();
    expect(await getProgress(draft.id)).toBeUndefined();
    expect(await db.highlights.count()).toBe(0);
    expect(await db.bookmarks.count()).toBe(0);
    expect(await db.blobs.get(draft.id + ':draft')).toBeUndefined();
    expect(updated.book.importedAt).toBe(1);
    expect(updated.book.settingsOverride).toEqual({ fontSize: 24 });
    expect(await getDraft(updated.book)).toBe('丙丁');
  });
  it('编辑冲突和写入失败回滚，原文与标注不会丢失', async () => {
    await saveDraft(draft, chapters, '甲乙');
    await annotate();
    const other = { ...draft, id: 'paste:other' };
    await saveDraft(other, chapters, '另一个');
    await expect(
      saveDraft(other, chapters, '另一个', draft.id),
    ).rejects.toThrow('已在书架');
    await expect(
      saveDraft(
        { ...draft, id: 'paste:bad' },
        [chapters[0]!, chapters[0]!],
        '重复',
        draft.id,
      ),
    ).rejects.toThrow();
    expect(await getBook(draft.id)).toBeDefined();
    expect(await getDraft((await getBook(draft.id))!)).toBe('甲乙');
    expect(await getProgress(draft.id)).toEqual(progress);
    expect(await db.highlights.count()).toBe(1);
    expect(await db.books.count()).toBe(2);
  });
});

describe('书架管理与原文件补导', () => {
  it('新导入保存章节摘要；旧书逐章回填摘要而不改变进度', async () => {
    await saveBook(
      book,
      splitChapters('第一章\n甲乙\n第二章\n丙丁'),
      new Blob(['正文']),
    );
    const summaries = await getChapterSummaries(book.id);
    expect(
      summaries.map((c) => [c.index, c.title, c.charStart, c.charCount]),
    ).toEqual([
      [0, '第一章', 0, 2],
      [1, '第二章', 2, 2],
    ]);
    await db.books.update(book.id, { chapterSummaries: undefined });
    await saveProgress({
      bookId: book.id,
      locator: { chapterIndex: 1, paragraphIndex: 0, charOffset: 1 },
      percent: 75,
      updatedAt: 3,
    });
    expect(await getChapterSummaries(book.id)).toEqual(summaries);
    expect((await getProgress(book.id))?.percent).toBe(75);
    expect((await getBook(book.id))?.chapterSummaries).toEqual(summaries);
  });
  it('书架批量关联进度，重命名不改指纹与进度', async () => {
    await saveBook(book, splitChapters('甲乙'), new Blob(['甲乙']));
    await saveProgress({
      bookId: book.id,
      locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
      percent: 50,
      updatedAt: 2,
    });
    await renameBook(book.id, '  新名字  ');
    const entries = await listShelf();
    expect(entries[0]?.book.title).toBe('新名字');
    expect(entries[0]?.book.id).toBe(book.id);
    expect(entries[0]?.progress?.percent).toBe(50);
    await expect(renameBook(book.id, '　 ')).rejects.toThrow('请输入');
  });
  it('删除清理全部相关表和所有本地图片，只影响指定书籍', async () => {
    await saveBook(
      { ...book, coverBlobId: 'test:image:0' },
      splitChapters('甲乙'),
      new Blob(['甲乙']),
      [
        { id: 'test:image:0', data: new Blob(['image0']) },
        { id: 'test:image:1', data: new Blob(['image1']) },
      ],
    );
    await saveBook(
      { ...book, id: 'other' },
      splitChapters('丙丁'),
      new Blob(['丙丁']),
    );
    const locator = { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 };
    await saveProgress({ bookId: book.id, locator, percent: 20, updatedAt: 2 });
    await db.bookmarks.put({
      id: 'b',
      bookId: book.id,
      locator,
      chapterTitle: '一',
      excerpt: '甲',
      createdAt: 2,
    });
    await db.highlights.put({
      id: 'h',
      bookId: book.id,
      chapterIndex: 0,
      start: locator,
      end: { paragraphIndex: 0, charOffset: 1 },
      text: '甲',
      color: 'red',
      createdAt: 2,
      updatedAt: 2,
    });
    await db.settings.put({
      id: 'global',
      value: { ...initialSettings(), lastBookId: book.id },
    });
    await deleteBook(book.id);
    expect(await db.books.count()).toBe(1);
    expect(await db.chapters.where('bookId').equals(book.id).count()).toBe(0);
    expect(await db.bookmarks.count()).toBe(0);
    expect(await db.highlights.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
    expect((await db.blobs.toArray()).map((b) => b.id)).toEqual(['other']);
    expect((await db.settings.get('global'))?.value.lastBookId).toBeUndefined();
    expect((await getBook('other'))?.title).toBe(book.title);
  });
  it('重新补导同指纹原文件，保留书名、进度和笔记', async () => {
    await db.books.add({ ...book, title: '恢复后的标题', missingFile: true });
    const progress = {
      bookId: book.id,
      locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
      percent: 50,
      updatedAt: 2,
    };
    await saveProgress(progress);
    await db.bookmarks.add({
      id: 'restored-bookmark',
      bookId: book.id,
      locator: progress.locator,
      chapterTitle: '一',
      excerpt: '甲',
      createdAt: 2,
    });
    await db.highlights.add({
      id: 'restored-note',
      bookId: book.id,
      chapterIndex: 0,
      start: { paragraphIndex: 0, charOffset: 0 },
      end: { paragraphIndex: 0, charOffset: 1 },
      text: '甲',
      color: 'blue',
      note: '恢复笔记',
      createdAt: 2,
      updatedAt: 2,
    });
    const inserted = await saveBook(
      book,
      splitChapters('甲乙'),
      new Blob(['甲乙']),
    );
    expect(inserted).toBe(true);
    expect((await getBook(book.id))?.title).toBe('恢复后的标题');
    expect((await getBook(book.id))?.missingFile).toBe(false);
    expect(await getProgress(book.id)).toEqual(progress);
    expect((await db.highlights.get('restored-note'))?.note).toBe('恢复笔记');
    expect(await db.bookmarks.get('restored-bookmark')).toBeDefined();
    expect((await getChapter(book.id, 0))?.paragraphs).toEqual(['甲乙']);
  });
});
afterEach(async () => {
  await db.delete();
});
describe('本地书籍事务与进度', () => {
  it('保存原文件与章节，同指纹导入不覆盖已有进度', async () => {
    const chapters = splitChapters('第一章\n甲乙');
    await saveBook(book, chapters, new Blob(['甲乙']));
    const progress = {
      bookId: book.id,
      locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
      percent: 50,
      updatedAt: 2,
    };
    await saveProgress(progress);
    await saveBook(book, chapters, new Blob(['甲乙']));
    expect(await listBooks()).toHaveLength(1);
    expect((await getBook(book.id))?.lastReadAt).toBe(2);
    expect((await getChapter(book.id, 0))?.paragraphs).toEqual(['甲乙']);
    expect(await getProgress(book.id)).toEqual(progress);
    expect((await db.blobs.get(book.id))?.data.size).toBe(6);
  });
  it('章节主键冲突时回滚整本导入，不留下半本书', async () => {
    const chapters = splitChapters('甲乙');
    await expect(
      saveBook(book, [chapters[0]!, chapters[0]!], new Blob(['甲乙'])),
    ).rejects.toThrow();
    expect(await getBook(book.id)).toBeUndefined();
    expect(await db.chapters.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
  });
});
