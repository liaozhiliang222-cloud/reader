import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createIncomingStore } from '@/db/incoming';
import { createDatabase } from '@/db/schema';
import { createIncomingJobs } from './incomingJobs';
import { incomingData, validIncomingId } from './incomingData';
import type { Book } from '@/types';
import type { ImportResult } from '@/parsers/batch';
const database = createDatabase('incoming-jobs-test');
const store = createIncomingStore(
  'https://local.test/',
  indexedDB,
  database.name,
);
const id = 'cfa59909-90c6-4a36-b56f-a067c5b5c08d';
const book: Book = {
  id: 'existing',
  title: '书籍',
  type: 'txt',
  size: 10,
  charCount: 10,
  chapterCount: 1,
  importedAt: 1,
  lastReadAt: 1,
};
beforeEach(async () => {
  await database.open();
});
afterEach(async () => {
  await database.delete();
});
const data = (files: string[], text = '') => ({
  files: files.map((name) => new File(['第一章\n自编文字'], name)),
  text,
  title: '',
  errors: [],
});
it('一次部分失败只保留失败原文件，重试不再解析已成功或重复的书，处理完才清理暂存', async () => {
  await store.put(id, data(['good.txt', 'bad.epub', 'exists.txt']));
  const parse = vi.fn<(file: File) => Promise<ImportResult>>(async (file) => {
    if (file.name === 'bad.epub') throw new Error('损坏EPUB');
    return { book, duplicate: file.name === 'exists.txt' };
  });
  const changed = vi.fn(),
    process = createIncomingJobs(() => store, parse, changed);
  const first = process(id, () => {});
  const result = await first.promise;
  first.release();
  expect(result.items.map((item) => item.status)).toEqual([
    'success',
    'error',
    'duplicate',
  ]);
  expect((await store.get(id)).files.map((file) => file.name)).toEqual([
    'bad.epub',
  ]);
  parse.mockResolvedValue({ book, duplicate: false });
  await process(id, () => {}).promise;
  expect(parse).toHaveBeenCalledTimes(4);
  expect((await store.list()).length).toBe(0);
  expect(changed).toHaveBeenCalledTimes(2);
});
it('同份分享重挂载共享解析及确认动作，移除旧监听，新监听收到结果，原文只删除一次', async () => {
  await store.put(id, data(['one.txt']));
  let complete!: (result: ImportResult) => void;
  const parse = vi.fn(
    () =>
      new Promise<ImportResult>((resolve) => {
        complete = resolve;
      }),
  );
  const remove = vi.spyOn(store, 'remove'),
    old = vi.fn(),
    current = vi.fn();
  const process = createIncomingJobs(
    () => store,
    parse,
    () => {},
  );
  const first = process(id, old);
  await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
  first.release();
  const previousCalls = old.mock.calls.length;
  const next = process(id, current);
  complete({ book, duplicate: true });
  await next.promise;
  expect(parse).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(old).toHaveBeenCalledTimes(previousCalls);
  expect(current.mock.calls.at(-1)?.[0][0]?.status).toBe('duplicate');
  next.release();
});
it('仅文字或混合分享保留可检查文字，不自动写为文稿；清理失败不丢原文，可再去重处理', async () => {
  await store.put(id, data([], '正文\n\nhttps://remote.test/a'));
  const parse = vi.fn(async () => ({ book, duplicate: false }));
  const process = createIncomingJobs(
    () => store,
    parse,
    () => {},
  );
  expect((await process(id, () => {}).promise).data.text).toBe(
    '正文\n\nhttps://remote.test/a',
  );
  expect(parse).not.toHaveBeenCalled();
  await store.put(id, data(['one.txt'], '要检查的分享文字'));
  await process(id, () => {}).promise;
  expect((await store.get(id)).files).toEqual([]);
  expect((await store.get(id)).text).toBe('要检查的分享文字');
  await store.put(id, data(['one.txt']));
  vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('disk'));
  await expect(process(id, () => {}).promise).rejects.toThrow('disk');
  expect((await store.get(id)).files.length).toBe(1);
  parse.mockResolvedValue({ book, duplicate: true });
  expect((await process(id, () => {}).promise).items[0]?.status).toBe(
    'duplicate',
  );
});
it('MIME补齐无扩展名、清理路径，显式不支持扩展名保留给正式导入器报错，非法共享字段拒绝', () => {
  const form = new FormData();
  form.append(
    'files',
    new File(['a'], '../目录/小说', { type: 'application/epub+zip' }),
  );
  form.append(
    'files',
    new File(['b'], 'other.pdf', { type: 'application/epub+zip' }),
  );
  form.append(
    'files',
    new File(['c'], '分享长文', { type: 'text/plain;charset=utf-8' }),
  );
  expect(incomingData(form).files.map((file) => file.name)).toEqual([
    '小说.epub',
    'other.pdf',
    '分享长文.txt',
  ]);
  form.append('files', new File(['# MD'], 'AI导出', { type: 'text/markdown' }));
  form.append(
    'files',
    new File(['# MD'], '另一份', { type: 'text/x-markdown;charset=utf-8' }),
  );
  expect(
    incomingData(form)
      .files.slice(-2)
      .map((file) => file.name),
  ).toEqual(['AI导出.md', '另一份.md']);
  form.set('text', new File(['x'], 'bad'));
  expect(() => incomingData(form)).toThrow('文字格式');
  expect(validIncomingId('../../')).toBe(false);
});
