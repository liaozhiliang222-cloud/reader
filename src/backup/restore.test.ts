import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { createDatabase } from '@/db/schema';
import { snapshotPayload as createSnapshot } from './fixtures';
import { prepareBooks } from './archive';
import { restoreBackup } from './restore';
import { fixturePayload, seed } from './fixtures';
import { clearAllData } from '@/db/data';
import JSZip from 'jszip';
import { parseFile } from '@/parsers/file';
import { sourcePath } from './types';
import { db } from '@/db';
import { saveBook, saveDraft } from '@/db/repository';
import { createIncomingStore } from '@/db/incoming';
const databases: ReturnType<typeof createDatabase>[] = [];
function database() {
  const value = createDatabase('backup-test-' + crypto.randomUUID());
  databases.push(value);
  return value;
}
afterEach(async () => {
  for (const value of databases.splice(0)) await value.delete();
});
it('覆盖书架保留未处理分享的文件与文字，事务保留全部元数据而不复活无关旧Blob', async () => {
  const target = database();
  await target.open();
  const store = createIncomingStore(
    'https://local.test/',
    indexedDB,
    target.name,
  );
  const id = 'cc08d27e-441e-4c2b-97a2-0dccf64a2121';
  await store.put(id, {
    files: [new File(['未处理原文'], '待导入.txt', { type: 'text/plain' })],
    text: '分享文字\n\n原换行',
    title: '待处理',
    errors: [],
  });
  await target.blobs.put({ id: 'obsolete-source', data: new Blob(['旧数据']) });
  const payload = await fixturePayload(1, false);
  await restoreBackup(
    payload,
    await prepareBooks(payload),
    'overwrite',
    target,
  );
  const pending = await store.get(id);
  expect(await pending.files[0]!.text()).toBe('未处理原文');
  expect(pending.text).toBe('分享文字\n\n原换行');
  expect(pending.title).toBe('待处理');
  expect(await target.blobs.get('obsolete-source')).toBeUndefined();
  expect(await target.books.count()).toBe(1);
  await clearAllData(target);
  expect(await store.list()).toEqual([]);
});
it('带图EPUB恢复本地封面、插图Blob、净化节点和目录，来源不是外链', async () => {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  );
  zip.file(
    'OPS/book.opf',
    '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">带图测试</dc:title></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="c"/></spine></package>',
  );
  zip.file(
    'OPS/chapter.xhtml',
    '<html><body><h1>第一章</h1><p>甲乙<strong>丙</strong>丁<img src="cover.png"/></p></body></html>',
  );
  zip.file('OPS/cover.png', Uint8Array.of(137, 80, 78, 71));
  const data = new Blob([await zip.generateAsync({ type: 'arraybuffer' })]),
    parsed = await parseFile(await data.arrayBuffer(), 'epub');
  const base = await fixturePayload(),
    meta = {
      id: parsed.id,
      title: parsed.title!,
      type: 'epub' as const,
      size: data.size,
      charCount: parsed.charCount,
      chapterCount: parsed.chapters.length,
      importedAt: 1,
      lastReadAt: 1,
    };
  const payload = {
    backup: {
      ...base.backup,
      books: [meta],
      progress: [],
      bookmarks: [],
      highlights: [],
      settings: { ...base.backup.settings, lastBookId: meta.id },
      files: [{ bookId: meta.id, path: sourcePath(meta) }],
    },
    originals: [{ bookId: meta.id, data }],
  };
  const a = database();
  await restoreBackup(payload, await prepareBooks(payload), 'overwrite', a);
  const book = (await a.books.get(meta.id))!;
  expect(book.coverBlobId).toBe(parsed.coverBlobId);
  expect((await a.blobs.get(book.coverBlobId!))?.data.type).toBe('image/png');
  const chapter = parsed.chapters[0]!;
  expect((await a.chapters.get([meta.id, 0]))?.nodes).toEqual(
    'nodes' in chapter ? chapter.nodes : undefined,
  );
  expect(book.toc).toEqual(parsed.toc);
  expect(await a.blobs.count()).toBe(2);
});
it('轻量恢复后经正式TXT/文稿存储补导，挂接原进度笔记并保留书名和导入时间', async () => {
  await db.open();
  databases.push(db);
  const payload = await fixturePayload();
  const light = {
    originals: [],
    backup: { ...payload.backup, kind: 'light' as const, files: [] },
  };
  await restoreBackup(light, [], 'merge');
  const prepared = await prepareBooks(payload);
  const draft = prepared.find((p) => p.book.type === 'paste')!;
  await db.books.update(draft.book.id, { title: '恢复后的自定书名' });
  for (const item of prepared) {
    const source = payload.originals.find(
      (o) => o.bookId === item.book.id,
    )!.data;
    if (item.book.type === 'paste')
      await saveDraft(
        { ...item.book, importedAt: 9999 },
        item.chapters,
        await source.text(),
      );
    else await saveBook(item.book, item.chapters, source);
  }
  expect((await db.books.get(draft.book.id))?.title).toBe('恢复后的自定书名');
  expect((await db.books.get(draft.book.id))?.importedAt).toBe(
    draft.book.importedAt,
  );
  expect(await db.progress.toArray()).toEqual(payload.backup.progress);
  expect(await db.highlights.toArray()).toEqual(payload.backup.highlights);
  expect(await db.bookmarks.toArray()).toEqual(payload.backup.bookmarks);
  expect(await db.books.filter((b) => !!b.missingFile).count()).toBe(0);
});
it('两套独立数据库完整恢复：书架、原文、进度、笔记及设置一致，原数据不受导出影响', async () => {
  const a = database(),
    b = database(),
    payload = await fixturePayload();
  await seed(a, await prepareBooks(payload), payload);
  const snapshot = await createSnapshot('full', a);
  expect(snapshot.backup.books[0]).not.toHaveProperty('fileBlobId');
  await restoreBackup(snapshot, await prepareBooks(snapshot), 'merge', b);
  expect(await b.books.toArray()).toEqual(await a.books.toArray());
  expect(await b.chapters.toArray()).toEqual(await a.chapters.toArray());
  expect(await b.progress.toArray()).toEqual(await a.progress.toArray());
  expect(await b.highlights.toArray()).toEqual(await a.highlights.toArray());
  expect(await b.bookmarks.toArray()).toEqual(await a.bookmarks.toArray());
  expect(await b.settings.toArray()).toEqual(await a.settings.toArray());
  expect(await b.blobs.count()).toBe(await a.blobs.count());
  const draft = snapshot.backup.books.find((book) => book.type === 'paste')!;
  expect(await (await b.blobs.get(draft.id + ':draft'))?.data.text()).toBe(
    await (await a.blobs.get(draft.id + ':draft'))?.data.text(),
  );
});
it('轻量恢复成为占位，完整原文补全时保留更近本地进度与笔记、书名和默认排版', async () => {
  const a = database(),
    payload = await fixturePayload();
  const light = {
    originals: [],
    backup: { ...payload.backup, kind: 'light' as const, files: [] },
  };
  await restoreBackup(light, [], 'merge', a);
  expect(await a.chapters.count()).toBe(0);
  expect(await a.books.filter((book) => !!book.missingFile).count()).toBe(3);
  const id = payload.backup.books[0]!.id;
  await a.books.update(id, { title: '本机书名' });
  await a.progress.update(id, { updatedAt: 900, percent: 10 });
  await a.highlights.update('highlight-a', {
    note: '本机新笔记',
    updatedAt: 900,
  });
  const global = (await a.settings.get('global'))!;
  global.value.reading.fontSize = 24;
  await a.settings.put(global);
  await restoreBackup(payload, await prepareBooks(payload), 'merge', a);
  expect((await a.books.get(id))?.title).toBe('本机书名');
  expect((await a.books.get(id))?.missingFile).toBe(false);
  expect((await a.progress.get(id))?.updatedAt).toBe(900);
  expect((await a.highlights.get('highlight-a'))?.note).toBe('本机新笔记');
  expect((await a.settings.get('global'))?.value.reading.fontSize).toBe(24);
  expect(await a.books.count()).toBe(3);
  expect(await a.chapters.count()).toBeGreaterThan(0);
});
it('轻量覆盖复用匹配原文，清理备份外的书及关联数据，完全替换设置和标注', async () => {
  const a = database(),
    payload = await fixturePayload();
  await seed(a, await prepareBooks(payload), payload);
  const light = {
    originals: [],
    backup: {
      ...payload.backup,
      kind: 'light' as const,
      files: [],
      books: [payload.backup.books[0]!],
    },
  };
  await restoreBackup(light, [], 'overwrite', a);
  expect(await a.books.count()).toBe(1);
  expect((await a.books.toArray())[0]?.missingFile).toBe(false);
  expect(await a.chapters.count()).toBe(2);
  expect(await a.blobs.count()).toBe(1);
  expect(await a.highlights.count()).toBe(1);
});
it('覆盖写入失败回滚整库；清空各表原子完成', async () => {
  const a = database(),
    payload = await fixturePayload();
  await seed(a, await prepareBooks(payload), payload);
  const before = await a.books.toArray(),
    fail = () => {
      throw new Error('quota');
    };
  a.books.hook('creating', fail);
  try {
    await expect(
      restoreBackup(payload, await prepareBooks(payload), 'overwrite', a),
    ).rejects.toThrow('quota');
  } finally {
    a.books.hook('creating').unsubscribe(fail);
  }
  expect(await a.books.toArray()).toEqual(before);
  expect(await a.chapters.count()).toBeGreaterThan(0);
  expect(await a.highlights.count()).toBe(1);
  await clearAllData(a);
  for (const table of a.tables) expect(await table.count()).toBe(0);
});
it('非法位置及跨书标注ID冲突失败，合并没有部分写入', async () => {
  const a = database(),
    payload = await fixturePayload();
  await seed(a, await prepareBooks(payload), payload);
  const before = await a.books.toArray();
  const bad = {
    ...payload,
    backup: {
      ...payload.backup,
      progress: [
        {
          ...payload.backup.progress[0]!,
          locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 999 },
        },
      ],
    },
  };
  await expect(
    restoreBackup(bad, await prepareBooks(payload), 'merge', a),
  ).rejects.toThrow('位置');
  expect(await a.books.toArray()).toEqual(before);
  const collision = {
    ...payload,
    backup: {
      ...payload.backup,
      bookmarks: [
        {
          ...payload.backup.bookmarks[0]!,
          bookId: payload.backup.books[1]!.id,
        },
      ],
    },
  };
  await expect(
    restoreBackup(collision, await prepareBooks(payload), 'merge', a),
  ).rejects.toThrow('冲突');
  expect((await a.bookmarks.get('bookmark-a'))?.bookId).toBe(
    payload.backup.books[0]!.id,
  );
  expect(await a.books.toArray()).toEqual(before);
});
