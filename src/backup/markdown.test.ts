import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { parseFile } from '@/parsers/file';
import { parseDraft } from '@/parsers/paste';
import { saveBook, saveDraft, getDraft } from '@/db/repository';
import { createSnapshot } from './snapshot';
import { BackupArchive, buildSnapshotArchive, readBackup } from './archive';
import { restoreBackup } from './restore';
import { validateBackup } from './validate';
import type { Book } from '@/types';

const source =
  '# 文章😀\n\n正文 **强调** 和 `代码`。\n\n| 列名 | 数值 |\n|---|---|\n| 项目 | 12 |\n\n```js\n  const x = 1;\n```\n\n## 末尾\n结尾正文';
beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
async function seed(type: 'md' | 'paste') {
  const original = new Blob([source]);
  const parsed =
    type === 'md'
      ? await parseFile(
          await original.arrayBuffer(),
          'md',
          undefined,
          undefined,
          1,
        )
      : await parseDraft(source, 'markdown', 1);
  const book: Book = {
    id: parsed.id,
    title: parsed.title!,
    type,
    draftFormat: type === 'paste' ? 'markdown' : undefined,
    markdownVersion: 1,
    charCount: parsed.charCount,
    size: original.size,
    chapterCount: parsed.chapters.length,
    toc: parsed.toc,
    importedAt: 1,
    lastReadAt: 1,
  };
  if (type === 'md') await saveBook(book, parsed.chapters, original);
  else await saveDraft(book, parsed.chapters, source);
  const where = { chapterIndex: 0, paragraphIndex: 1, charOffset: 3 };
  await db.progress.put({
    bookId: book.id,
    locator: where,
    percent: 5,
    updatedAt: 2,
  });
  await db.bookmarks.put({
    id: 'mark',
    bookId: book.id,
    locator: where,
    chapterTitle: '文章😀',
    excerpt: '正文',
    createdAt: 2,
  });
  await db.highlights.put({
    id: 'note',
    bookId: book.id,
    chapterIndex: 0,
    start: { paragraphIndex: 1, charOffset: 3 },
    end: { paragraphIndex: 1, charOffset: 5 },
    text: '强调',
    color: 'red',
    note: '保留这条笔记',
    createdAt: 2,
    updatedAt: 2,
  });
  return { book, parsed, original };
}
it.each(['md', 'paste'] as const)(
  '%s完整ZIP往返后原文、格式、节点、锚点和笔记位置不变',
  async (type) => {
    const { book, parsed } = await seed(type);
    const snapshot = await createSnapshot('full');
    expect(snapshot.backup.books[0]?.markdownVersion).toBe(1);
    const archiveFile = new File(
      [
        await buildSnapshotArchive(
          snapshot.backup,
          async (id) =>
            (await db.blobs.get(
              snapshot.sources.find((s) => s.bookId === id)!.blobId,
            ))!.data,
        ),
      ],
      'backup.zip',
    );
    const metadata = await readBackup(archiveFile);
    const archive = await BackupArchive.open(archiveFile);
    const prepared = await archive.prepare(book.id);
    await archive.verifyRemaining();
    expect(prepared.chapters.map((c) => c.paragraphs)).toEqual(
      parsed.chapters.map((c) => c.paragraphs),
    );
    expect(prepared.book.toc).toEqual(parsed.toc);
    expect(prepared.chapters.map((c) => c.nodes)).toEqual(
      parsed.chapters.map((c) => ('nodes' in c ? c.nodes : undefined)),
    );
    await db.delete();
    await db.open();
    await restoreBackup({ backup: metadata }, [prepared], 'merge');
    expect((await db.highlights.get('note'))?.note).toBe('保留这条笔记');
    expect((await db.progress.get(book.id))?.locator.charOffset).toBe(3);
    expect((await db.books.get(book.id))?.markdownVersion).toBe(1);
    const restored = (await db.books.get(book.id))!;
    expect(
      await (await db.blobs.get(
        restored.fileBlobId ?? restored.draftBlobId!,
      ))!.data.text(),
    ).toBe(source);
  },
);
it.each(['md', 'paste'] as const)(
  '%s轻备份恢复、补导后仍保留标注；ID和格式版本严格校验',
  async (type) => {
    const { book, parsed, original } = await seed(type);
    const snapshot = await createSnapshot('light');
    await db.delete();
    await db.open();
    await restoreBackup(snapshot, [], 'merge');
    expect((await db.books.get(book.id))?.missingFile).toBe(true);
    if (type === 'md') await saveBook(book, parsed.chapters, original);
    else await saveDraft(book, parsed.chapters, source);
    expect((await db.books.get(book.id))?.missingFile).toBe(false);
    expect((await db.highlights.get('note'))?.text).toBe('强调');
    expect((await db.bookmarks.get('mark'))?.locator.charOffset).toBe(3);
    for (const patch of [
      { schemaVersion: 3 },
      { books: [{ ...snapshot.backup.books[0], markdownVersion: 3 }] },
      { books: [{ ...snapshot.backup.books[0], id: book.id.slice(-64) }] },
    ])
      expect(() => validateBackup({ ...snapshot.backup, ...patch })).toThrow();
  },
);
it('Markdown文稿仅改标题保留笔记；切换纯文本确认保存后重置，原文不改写', async () => {
  const { book, parsed } = await seed('paste');
  await saveDraft({ ...book, title: '改名' }, parsed.chapters, source, book.id);
  expect(await db.highlights.count()).toBe(1);
  const plain = await parseDraft(source);
  const saved = await saveDraft(
    {
      ...book,
      id: plain.id,
      draftFormat: undefined,
      markdownVersion: undefined,
      toc: plain.toc,
      charCount: plain.charCount,
      chapterCount: plain.chapters.length,
    },
    plain.chapters,
    source,
    book.id,
  );
  expect(await db.highlights.count()).toBe(0);
  expect(await db.progress.count()).toBe(0);
  expect(await getDraft(saved.book)).toBe(source);
  expect(await db.books.get(book.id)).toBeUndefined();
});
