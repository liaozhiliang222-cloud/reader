import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from './index';
import { applyEncoding } from './recode';
import { saveBook, getProgress, saveProgress } from './repository';
import { addBookmark } from './bookmarks';
import { addHighlight } from './highlights';
import { parseText } from '@/parsers/file';
import { splitChapters } from '@/parsers/txt/chapters';
import { snapshotPayload as createSnapshot } from '@/backup/fixtures';
import { prepareBooks } from '@/backup/archive';
import { validateBackup } from '@/backup/validate';
import { restoreBackup } from '@/backup/restore';
import { createDatabase } from './schema';
import { notesMarkdown } from '@/reader/exportNotes';
import type { Book } from '@/types';

async function seed() {
  const data = readFileSync(
    new URL('../parsers/txt/fixtures/big5-ambiguous.bin', import.meta.url),
  );
  const original = new Blob([Uint8Array.from(data)]);
  const parsed = await parseText(await original.arrayBuffer());
  const book: Book = {
    id: parsed.id,
    title: '我的繁体书',
    type: 'txt',
    encoding: parsed.encoding,
    charCount: parsed.charCount,
    chapterCount: parsed.chapters.length,
    importedAt: 10,
    lastReadAt: 10,
    size: original.size,
    settingsOverride: { fontSize: 24, theme: 'green' },
  };
  await saveBook(book, parsed.chapters, original);
  const locator = { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 };
  await addBookmark({
    bookId: book.id,
    locator,
    chapterTitle: '第 1 部分',
    excerpt: parsed.chapters[0]!.paragraphs[0]!,
  });
  await addHighlight(
    book.id,
    {
      chapterIndex: 0,
      start: locator,
      end: { paragraphIndex: 0, charOffset: 1 },
    },
    'blue',
    '原笔记',
  );
  await saveProgress({ bookId: book.id, locator, percent: 50, updatedAt: 20 });
  return { book, original, parsed };
}
beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

it('正确编码改变章节数时按全书百分比重新定位，首尾与代理对边界有效', async () => {
  const text = '第一章 春\n甲乙🌸丙丁\n第二章 夏\n庚辛壬癸🌸甲乙';
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes.push(code & 255, code >>> 8);
  }
  const original = new Blob([Uint8Array.from(bytes)]);
  const wrong = await parseText(await original.arrayBuffer(), 'utf-16be');
  const correct = await parseText(await original.arrayBuffer(), 'utf-16le');
  expect(wrong.chapters).toHaveLength(1);
  expect(correct.chapters).toHaveLength(2);
  let book: Book = {
    id: wrong.id,
    title: '章节编码',
    type: 'txt',
    encoding: wrong.encoding,
    charCount: wrong.charCount,
    chapterCount: wrong.chapters.length,
    importedAt: 1,
    lastReadAt: 1,
    size: original.size,
  };
  await saveBook(book, wrong.chapters, original);
  for (const requested of [37.5, 0, 100]) {
    book = await applyEncoding(book, correct, requested);
    const progress = (await getProgress(book.id))!;
    expect(Math.abs(progress.percent - requested)).toBeLessThan(
      200 / correct.charCount,
    );
    const paragraph =
      correct.chapters[progress.locator.chapterIndex]!.paragraphs[
        progress.locator.paragraphIndex
      ]!;
    expect(paragraph[progress.locator.charOffset] ?? '').not.toMatch(
      /[\uDC00-\uDFFF]/,
    );
    if (requested === 0 || requested === 100)
      expect(progress.percent).toBe(requested);
  }
});

it('故意选错后切回正确编码，正文恢复、指纹与原文件不变，进度按比例重定位', async () => {
  const { book, original } = await seed();
  const correct = await parseText(await original.arrayBuffer(), 'big5');
  expect(correct.chapters[0]?.paragraphs).toEqual(['中文閱讀']);
  const fixed = await applyEncoding(book, correct, 75);
  expect(fixed).toMatchObject({
    id: book.id,
    title: book.title,
    encoding: 'big5',
    contentRevision: 1,
    importedAt: 10,
    settingsOverride: { fontSize: 24, theme: 'green' },
  });
  expect((await getProgress(book.id))?.percent).toBe(75);
  expect(await (await db.blobs.get(book.id))!.data.arrayBuffer()).toEqual(
    await original.arrayBuffer(),
  );
  const wrong = await applyEncoding(
    fixed,
    await parseText(await original.arrayBuffer(), 'gb18030'),
    75,
  );
  expect(wrong.contentRevision).toBe(2);
  const recovered = await applyEncoding(wrong, correct, 75);
  expect(recovered.encoding).toBe('big5');
  expect((await db.chapters.get([book.id, 0]))?.paragraphs).toEqual([
    '中文閱讀',
  ]);
});

it('改变正文不删除摘录或笔记，旧锚点不再渲染；未改变章节保持定位', async () => {
  const { book, original, parsed } = await seed();
  const untouched = await applyEncoding(
    book,
    { ...parsed, encoding: 'gb18030' },
    50,
  );
  expect((await db.highlights.toArray())[0]?.unanchored).toBeUndefined();
  expect((await db.bookmarks.toArray())[0]?.unanchored).toBeUndefined();
  const fixed = await applyEncoding(
    untouched,
    await parseText(await original.arrayBuffer(), 'big5'),
    50,
  );
  const highlight = (await db.highlights.toArray())[0]!;
  const bookmark = (await db.bookmarks.toArray())[0]!;
  expect(highlight).toMatchObject({
    text: parsed.chapters[0]!.paragraphs[0]!.slice(0, 1),
    note: '原笔记',
    unanchored: true,
  });
  expect(bookmark.unanchored).toBe(true);
  expect(notesMarkdown(fixed, fixed.chapterSummaries!, [highlight])).toContain(
    '位置待确认',
  );
  const added = await addHighlight(
    book.id,
    {
      chapterIndex: 0,
      start: { paragraphIndex: 0, charOffset: 0 },
      end: { paragraphIndex: 0, charOffset: 1 },
    },
    'red',
    '新正文笔记',
    2,
  );
  expect(added.id).not.toBe(highlight.id);
  expect(await db.highlights.count()).toBe(2);
});

it('拒绝旧页面与过期预览；旧进度延迟保存和旧标注不能覆盖新正文', async () => {
  const { book, original } = await seed();
  const parsed = await parseText(await original.arrayBuffer(), 'big5');
  const updated = await applyEncoding(book, parsed, 50);
  const progress = await getProgress(book.id);
  await saveProgress(
    {
      bookId: book.id,
      locator: { chapterIndex: 999, paragraphIndex: 99, charOffset: 99 },
      percent: 99,
      updatedAt: Date.now() + 1,
    },
    0,
  );
  expect(await getProgress(book.id)).toEqual(progress);
  await expect(applyEncoding(book, parsed, 90)).rejects.toThrow('其他页面更新');
  const loc = { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 };
  await expect(
    addBookmark(
      { bookId: book.id, locator: loc, chapterTitle: '旧', excerpt: '旧' },
      0,
    ),
  ).rejects.toThrow('其他页面更新');
  await expect(
    addHighlight(
      book.id,
      {
        chapterIndex: 0,
        start: loc,
        end: { paragraphIndex: 0, charOffset: 1 },
      },
      'red',
      undefined,
      0,
    ),
  ).rejects.toThrow('其他页面更新');
  await saveProgress({ ...progress!, percent: 25 }, updated.contentRevision);
  expect((await getProgress(book.id))?.percent).toBe(25);
});

it('写入失败整笔事务回滚，旧章节、进度、标注和文件全部保持', async () => {
  const { book, parsed } = await seed();
  const progress = await getProgress(book.id);
  const highlight = (await db.highlights.toArray())[0];
  const bad = splitChapters('完全不同正文')[0]!;
  await expect(
    applyEncoding(book, { ...parsed, chapters: [bad, bad] }, 25),
  ).rejects.toThrow();
  expect((await db.books.get(book.id))?.encoding).toBe(book.encoding);
  expect((await db.books.get(book.id))?.contentRevision).toBeUndefined();
  expect((await db.chapters.get([book.id, 0]))?.paragraphs).toEqual(
    parsed.chapters[0]!.paragraphs,
  );
  expect(await getProgress(book.id)).toEqual(progress);
  expect((await db.highlights.toArray())[0]).toEqual(highlight);
  expect(await db.blobs.get(book.id)).toBeDefined();
});

it('完整备份与轻量备份往返保留编码和待确认笔记，允许旧章节已不存在的摘录', async () => {
  const { book, original } = await seed();
  const fixed = await applyEncoding(
    book,
    await parseText(await original.arrayBuffer(), 'big5'),
    50,
  );
  await db.highlights.toCollection().modify({ chapterIndex: 99 });
  await db.bookmarks.toCollection().modify({
    locator: { chapterIndex: 99, paragraphIndex: 0, charOffset: 0 },
  });
  const payload = await createSnapshot('full');
  expect(validateBackup(payload.backup).books[0]?.encoding).toBe('big5');
  const prepared = await prepareBooks(payload);
  expect(prepared[0]?.chapters[0]?.paragraphs).toEqual(['中文閱讀']);
  const target = createDatabase('recode-restore-' + crypto.randomUUID());
  try {
    await restoreBackup(payload, prepared, 'overwrite', target);
    expect((await target.highlights.toArray())[0]).toMatchObject({
      unanchored: true,
      note: '原笔记',
      chapterIndex: 99,
    });
    expect((await target.books.get(book.id))?.contentRevision).toBe(
      fixed.contentRevision,
    );
    const light = await createSnapshot('light', target);
    expect(validateBackup(light.backup).highlights[0]?.unanchored).toBe(true);
  } finally {
    await target.delete();
  }
});
