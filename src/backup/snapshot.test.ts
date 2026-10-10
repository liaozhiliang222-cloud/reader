import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createDatabase } from '@/db/schema';
import type { Book } from '@/types';
import { fixturePayload, seed } from './fixtures';
import { buildSnapshotArchive, prepareBooks, readBackup } from './archive';
import { createSnapshot, readSnapshotOriginal } from './snapshot';

const database = createDatabase('export-snapshot-test');
beforeEach(async () => {
  await database.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.delete();
});

it('百本各两千章分批投影，快照不获取原文值、不聚合目录摘要，原库保持完整', async () => {
  const chapters = Array.from({ length: 2000 }, (_, index) => ({
    index,
    title: `第${index}章`,
    charStart: index * 10,
    charCount: 10,
  }));
  const books: Book[] = Array.from({ length: 100 }, (_, index) => ({
    id: index.toString(16).padStart(64, '0'),
    title: `原创${index}`,
    type: 'txt',
    size: 8,
    charCount: 20000,
    chapterCount: 2000,
    importedAt: index,
    lastReadAt: index,
    fileBlobId: `original-${index}`,
    coverBlobId: `cover-${index}`,
    chapterSummaries: chapters,
    toc: chapters.map((c) => ({
      title: c.title,
      chapterIndex: c.index,
      level: 0,
      paragraphIndex: 0,
    })),
  }));
  await database.books.bulkPut(books);
  await database.blobs.bulkPut(
    books.map((book) => ({
      id: book.fileBlobId!,
      data: new Blob(['original']),
    })),
  );
  const nativeGetAll = IDBObjectStore.prototype.getAll;
  const batches: number[] = [];
  vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
    this: IDBObjectStore,
    query,
    count,
  ) {
    if (this.name === 'books')
      batches.push(
        count ??
          (query &&
          typeof query === 'object' &&
          'count' in query &&
          typeof query.count === 'number'
            ? query.count
            : 0),
      );
    return nativeGetAll.call(this, query, count);
  });
  const nativeGet = IDBObjectStore.prototype.get;
  const blobReads: (IDBValidKey | IDBKeyRange)[] = [];
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (this.name === 'blobs') blobReads.push(key);
    return nativeGet.call(this, key);
  });
  const full = await createSnapshot('full', database);
  expect(full.backup.books.map((book) => book.id)).toEqual(
    books.map((book) => book.id),
  );
  expect(full.sources).toEqual(
    books.map((book) => ({
      bookId: book.id,
      blobId: book.fileBlobId,
      size: 8,
    })),
  );
  expect(batches).toEqual([32, 32, 32, 32]);
  expect(blobReads).toEqual([]);
  expect(full).not.toHaveProperty('originals');
  for (const book of full.backup.books)
    for (const field of [
      'toc',
      'chapterSummaries',
      'fileBlobId',
      'coverBlobId',
      'draftBlobId',
    ])
      expect(book).not.toHaveProperty(field);
  const light = await createSnapshot('light', database);
  expect(light.sources).toEqual([]);
  expect(light.backup.files).toEqual([]);
  expect(light.backup.books).toEqual(full.backup.books);
  expect(blobReads).toEqual([]);
  expect(await database.books.get(books[0]!.id)).toEqual(books[0]);
});

it('快照只引用实际可用的书籍原文键，兼容自定义键和文稿，不纳入封面/分享/恢复暂存', async () => {
  const payload = await fixturePayload(3);
  const prepared = await prepareBooks(payload);
  await seed(database, prepared, payload);
  const first = prepared[0]!.book,
    second = prepared[1]!.book,
    third = prepared[2]!.book;
  const source = await database.blobs.get(first.fileBlobId!);
  await database.blobs.put({ ...source!, id: 'custom-original' });
  await database.blobs.delete(first.fileBlobId!);
  await database.books.update(first.id, { fileBlobId: 'custom-original' });
  await database.books.update(second.id, { missingFile: true });
  await database.blobs.delete(third.fileBlobId!);
  await database.blobs.bulkPut(
    ['incoming:test', 'restore-stage:test', 'cover:test'].map((id) => ({
      id,
      data: new Blob(['ignore']),
    })),
  );
  const snapshot = await createSnapshot('full', database);
  expect(snapshot.backup.books).toHaveLength(4);
  expect(snapshot.sources).toHaveLength(2);
  expect(snapshot.sources).toContainEqual({
    bookId: first.id,
    blobId: 'custom-original',
    size: first.size,
  });
  expect(
    snapshot.sources.find((row) => row.bookId.startsWith('paste:'))!.blobId,
  ).toBe(prepared[3]!.book.draftBlobId);
  expect(snapshot.backup.files.map((row) => row.bookId)).toEqual(
    snapshot.sources.map((row) => row.bookId),
  );
});

it('逐书供给时可继续写库，导出仍使用快照时的元数据/笔记/设置并保留每份原文字节', async () => {
  const payload = await fixturePayload(2);
  await seed(database, await prepareBooks(payload), payload);
  const snapshot = await createSnapshot('full', database);
  const sources = new Map(
    snapshot.sources.map((source) => [source.bookId, source]),
  );
  const order: string[] = [];
  let active = 0,
    peak = 0;
  const blob = await buildSnapshotArchive(snapshot.backup, async (bookId) => {
    order.push(bookId);
    peak = Math.max(peak, ++active);
    // These writes must complete while ZIP generation awaits this callback.
    await database.books.update(bookId, { title: '生成后改名' });
    await database.highlights.update(payload.backup.highlights[0]!.id, {
      note: '生成后的新笔记',
    });
    try {
      return await readSnapshotOriginal(sources.get(bookId)!, database);
    } finally {
      active--;
    }
  });
  expect(peak).toBe(1);
  expect(order).toEqual(snapshot.backup.files.map((file) => file.bookId));
  const archive = await JSZip.loadAsync(await blob.arrayBuffer(), {
    checkCRC32: true,
  });
  expect(
    JSON.parse(await archive.file('backup.json')!.async('string')),
  ).toEqual(snapshot.backup);
  for (const file of snapshot.backup.files)
    expect(await archive.file(file.path)!.async('string')).toBe(
      await payload.originals
        .find((source) => source.bookId === file.bookId)!
        .data.text(),
    );
  const preview = await readBackup(new File([blob], 'full.zip'));
  expect(preview.highlights[0]!.note).toBe(payload.backup.highlights[0]!.note);
  expect(preview.books.every((book) => book.title !== '生成后改名')).toBe(true);
});

it.each(['deleted', 'resized', 'replaced'] as const)(
  '快照后原文%s时整个导出失败，无后续原文读取或半个ZIP，书籍与笔记保持',
  async (change) => {
    const payload = await fixturePayload(2, false);
    await seed(database, await prepareBooks(payload), payload);
    const snapshot = await createSnapshot('full', database);
    const first = snapshot.sources[0]!;
    if (change === 'deleted') await database.blobs.delete(first.blobId);
    else {
      const bytes = new Uint8Array(
        await (await readSnapshotOriginal(first, database)).arrayBuffer(),
      );
      bytes[0] = bytes[0]! ^ 1;
      await database.blobs.put({
        id: first.blobId,
        data: new Blob(change === 'resized' ? [bytes, 'x'] : [bytes]),
      });
    }
    const read = vi.fn(async (bookId: string) =>
      readSnapshotOriginal(
        snapshot.sources.find((source) => source.bookId === bookId)!,
        database,
      ),
    );
    await expect(buildSnapshotArchive(snapshot.backup, read)).rejects.toThrow(
      change === 'deleted' ? '不可用' : change === 'resized' ? '大小' : '指纹',
    );
    expect(read.mock.calls).toEqual([[first.bookId]]);
    expect((await createSnapshot('light', database)).backup.highlights).toEqual(
      snapshot.backup.highlights,
    );
    expect((await createSnapshot('light', database)).backup.books).toEqual(
      snapshot.backup.books,
    );
  },
);

it('原文供给进入前已取消或IDB等待时取消均不交付迟到Blob', async () => {
  const payload = await fixturePayload(1, false);
  await seed(database, await prepareBooks(payload), payload);
  const source = (await createSnapshot('full', database)).sources[0]!;
  const controller = new AbortController();
  controller.abort();
  const native = database.blobs.get.bind(database.blobs);
  const read = vi.spyOn(database.blobs, 'get');
  await expect(
    readSnapshotOriginal(source, database, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled();
  const next = new AbortController();
  read.mockImplementation((key) =>
    native(key).then((result) => {
      next.abort();
      return result;
    }),
  );
  await expect(
    readSnapshotOriginal(source, database, next.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
