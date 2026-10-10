import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import JSZip from 'jszip';
import { db } from '@/db';
import { parseFile } from '@/parsers/file';
import { parseDraft } from '@/parsers/paste';
import { saveBook, saveDraft } from '@/db/repository';
import { createSnapshot } from './snapshot';
import { buildSnapshotArchive, BackupArchive, prepareBook } from './archive';
import { restoreBackup } from './restore';
import { validateBackup } from './validate';
import type { Book } from '@/types';

beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
it.each(['file', 'package', 'paste'] as const)(
  '%s第二版完整与轻量备份保留原件、附件、版本、脚注和标注位置',
  async (kind) => {
    const source =
      '# 第二版\n\n前 $x^2$ 后😀文[^中]\n\n![图](assets/a.svg)\n\n[[第二版|返回标题]]\n\n```mermaid\ngraph TD; A-->B;\n```\n\n[^中]: 注释正文';
    const zip = new JSZip()
      .file('article.md', source)
      .file(
        'assets/a.svg',
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>',
      );
    const original =
      kind === 'package'
        ? new Blob([await zip.generateAsync({ type: 'arraybuffer' })])
        : new Blob([source]);
    const parsed =
      kind === 'paste'
        ? await parseDraft(source, 'markdown')
        : await parseFile(await original.arrayBuffer(), 'md');
    const book: Book = {
      id: parsed.id,
      title: parsed.title!,
      type: kind === 'paste' ? 'paste' : 'md',
      draftFormat: kind === 'paste' ? 'markdown' : undefined,
      markdownVersion: 2,
      chapterCount: parsed.chapters.length,
      charCount: parsed.charCount,
      size: original.size,
      toc: parsed.toc,
      importedAt: 1,
      lastReadAt: 1,
    };
    if (kind === 'paste') await saveDraft(book, parsed.chapters, source);
    else
      await saveBook(
        book,
        parsed.chapters,
        original,
        'assets' in parsed ? parsed.assets : [],
      );
    const text = parsed.chapters[0]!.paragraphs[1]!,
      start = text.indexOf('后');
    await db.highlights.put({
      id: 'md2-note',
      bookId: book.id,
      chapterIndex: 0,
      start: { paragraphIndex: 1, charOffset: start },
      end: { paragraphIndex: 1, charOffset: start + 4 },
      text: '后😀文',
      color: 'red',
      note: '公式之后的笔记',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.progress.put({
      bookId: book.id,
      locator: { chapterIndex: 0, paragraphIndex: 1, charOffset: start },
      percent: 10,
      updatedAt: 1,
    });
    const snapshot = await createSnapshot('full');
    const archive = await buildSnapshotArchive(
      snapshot.backup,
      async (id) =>
        (await db.blobs.get(
          snapshot.sources.find((s) => s.bookId === id)!.blobId,
        ))!.data,
    );
    const opened = await BackupArchive.open(new File([archive], 'backup.zip'));
    const prepared = await opened.prepare(book.id);
    await opened.verifyRemaining();
    expect(prepared.chapters.map((c) => c.paragraphs)).toEqual(
      parsed.chapters.map((c) => c.paragraphs),
    );
    expect(prepared.book.markdownVersion).toBe(2);
    expect(prepared.book.toc).toEqual(parsed.toc);
    expect(
      new Uint8Array(
        await prepared.blobs
          .find(
            (b) =>
              b.id === prepared.book.fileBlobId ||
              b.id === prepared.book.draftBlobId,
          )!
          .data.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array(await original.arrayBuffer()));
    if (kind === 'package')
      expect(prepared.blobs.some((b) => b.data.type === 'image/svg+xml')).toBe(
        true,
      );
    const light = await createSnapshot('light');
    await db.delete();
    await db.open();
    await restoreBackup({ backup: validateBackup(light.backup) }, [], 'merge');
    expect((await db.books.get(book.id))?.missingFile).toBe(true);
    const reimported = await prepareBook(light.backup.books[0]!, {
      bookId: book.id,
      data: original,
    });
    await restoreBackup(
      { backup: validateBackup(snapshot.backup) },
      [reimported],
      'merge',
    );
    expect((await db.highlights.get('md2-note'))?.start.charOffset).toBe(start);
    expect((await db.progress.get(book.id))?.locator.charOffset).toBe(start);
    expect((await db.books.get(book.id))?.missingFile).toBe(false);
  },
);
