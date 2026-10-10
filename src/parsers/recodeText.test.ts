import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { importText } from './importText';
import { parseText, parseFile } from './file';
import { previewEncoding } from './recodeText';
import type { Book } from '@/types';
import { compatibilityEpub } from './epub/compatFixtures';

const rpc = vi.hoisted(() => {
  const release = Symbol('releaseProxy');
  const releaseMock = vi.fn();
  return {
    release,
    releaseMock,
    api: {
      parseText: vi.fn<typeof parseText>(),
      parseFile: vi.fn<typeof parseFile>(),
      [release]: releaseMock,
    },
  };
});
vi.mock('comlink', () => ({
  releaseProxy: rpc.release,
  wrap: () => rpc.api,
  transfer: (value: ArrayBuffer) => value,
}));
class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  terminate = vi.fn();
  constructor() {
    super();
    TestWorker.instances.push(this);
  }
}
async function source() {
  const data = readFileSync(
    new URL('./txt/fixtures/big5-ambiguous.bin', import.meta.url),
  );
  const file = new File([Uint8Array.from(data)], 'book.txt');
  const parsed = await parseText(await file.arrayBuffer());
  const book: Book = {
    id: parsed.id,
    title: '恢复书名',
    type: 'txt',
    encoding: 'big5',
    charCount: 4,
    chapterCount: 1,
    importedAt: 1,
    lastReadAt: 2,
    size: file.size,
    contentRevision: 1,
  };
  await db.books.put(book);
  await db.blobs.put({ id: book.id, data: file });
  return { book, file };
}
beforeEach(async () => {
  await db.open();
  vi.stubGlobal('Worker', TestWorker);
  rpc.api.parseText.mockReset().mockImplementation(parseText);
  rpc.api.parseFile.mockReset().mockImplementation(parseFile);
  rpc.releaseMock.mockClear();
  TestWorker.instances = [];
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
});

it('原文件在 Worker RPC 中预览，不写派生内容；成功与解码失败均释放线程', async () => {
  const { book } = await source();
  expect((await previewEncoding(book, 'big5')).chapters[0]?.paragraphs).toEqual(
    ['中文閱讀'],
  );
  expect(await db.chapters.count()).toBe(0);
  expect((await db.books.get(book.id))?.contentRevision).toBe(1);
  await expect(previewEncoding(book, 'utf-8')).rejects.toThrow('无法完整解码');
  expect(rpc.releaseMock).toHaveBeenCalledTimes(2);
  expect(
    TestWorker.instances.every(
      (worker) => worker.terminate.mock.calls.length === 1,
    ),
  ).toBe(true);
});

it('取消正在解析的预览，悬空 RPC 结束等待且线程释放；预先取消不创建线程', async () => {
  const { book } = await source();
  rpc.api.parseText.mockImplementation(() => new Promise(() => {}));
  const abort = new AbortController();
  const pending = previewEncoding(book, 'big5', abort.signal);
  const assertion = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await vi.waitFor(() => expect(rpc.api.parseText).toHaveBeenCalledOnce());
  abort.abort();
  await assertion;
  expect(TestWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  await expect(
    previewEncoding(book, 'big5', abort.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.instances).toHaveLength(1);
});

it('轻量备份补导同指纹原文件，沿用手动 Big5 编码并保留版本、书名与进度', async () => {
  const { book, file } = await source();
  await db.books.update(book.id, { missingFile: true });
  await db.blobs.delete(book.id);
  const progress = {
    bookId: book.id,
    locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 2 },
    percent: 50,
    updatedAt: 2,
  };
  await db.progress.put(progress);
  const result = await importText(file);
  expect(result.book).toMatchObject({
    id: book.id,
    title: '恢复书名',
    encoding: 'big5',
    contentRevision: 1,
    missingFile: false,
  });
  expect((await db.chapters.get([book.id, 0]))?.paragraphs).toEqual([
    '中文閱讀',
  ]);
  expect(await db.progress.get(book.id)).toEqual(progress);
  expect(rpc.api.parseFile).toHaveBeenCalledTimes(2);
  expect(rpc.api.parseFile.mock.calls[1]?.[2]).toBe('big5');
  expect(TestWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
});

it('旧EPUB轻量备份补导按旧规则解析，段落和旧进度不被新规则替换', async () => {
  const file = new File(
    [
      await compatibilityEpub(
        '<ul><li>段前<p id="target">正文</p>段后</li></ul>',
      ),
    ],
    'old.epub',
  );
  const old = await parseFile(await file.arrayBuffer(), 'epub', undefined, 1);
  await db.books.put({
    id: old.id,
    title: '旧书名',
    type: 'epub',
    size: file.size,
    chapterCount: 1,
    charCount: old.charCount,
    importedAt: 1,
    lastReadAt: 1,
    missingFile: true,
  });
  const progress = {
    bookId: old.id,
    locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
    percent: 50,
    updatedAt: 1,
  };
  await db.progress.put(progress);
  const imported = await importText(file);
  expect(imported.book.parserVersion).toBe(1);
  expect(imported.book.title).toBe('旧书名');
  expect((await db.chapters.get([old.id, 0]))?.paragraphs).toEqual(['正文']);
  expect(await db.progress.get(old.id)).toEqual(progress);
  expect(rpc.api.parseFile.mock.calls[1]?.[3]).toBe(1);
  expect(TestWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
});
