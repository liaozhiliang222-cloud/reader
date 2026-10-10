import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase } from './schema';
import { createIncomingStore } from './incoming';
import { createIncomingClient } from './incomingClient';
import { incomingData, incomingForm } from '@/app/incomingData';
import { clearAllData } from './data';
import { createSnapshot } from '@/backup/snapshot';
const database = createDatabase('incoming-test');
const scope = 'https://local.test/reader/';
const id = 'fe8090e1-91c8-4bde-913c-c3505d58fa28';
const store = createIncomingStore(scope, indexedDB, database.name);
function sample() {
  const form = new FormData();
  form.append(
    'files',
    new File(['第一章 静夜\n中文正文'], '分享.txt', { type: 'text/plain' }),
  );
  form.append(
    'files',
    new File([new Uint8Array([80, 75, 3, 4, 255])], '书籍.epub', {
      type: 'application/epub+zip',
    }),
  );
  form.set('text', '保留文字 <script> 与 & 符号');
  form.set('title', '分享标题');
  form.set('url', 'https://example.test/article');
  return incomingData(form);
}
beforeEach(async () => {
  await database.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.delete();
});
it('原生SW写入同一blobs表，Dexie重开后读取文字及两份原始文件字节，按作用域隔离', async () => {
  const data = sample();
  await store.put(id, data);
  database.close();
  await database.open();
  const reopened = createIncomingStore(scope, indexedDB, database.name);
  const restored = await reopened.get(id);
  expect(await reopened.list()).toEqual([id]);
  expect(restored.title).toBe(data.title);
  expect(restored.text).toBe(data.text);
  for (const [index, file] of data.files.entries()) {
    expect(restored.files[index]!.name).toBe(file.name);
    expect(restored.files[index]!.type).toBe(file.type);
    expect(await restored.files[index]!.arrayBuffer()).toEqual(
      await file.arrayBuffer(),
    );
  }
  expect(
    await createIncomingStore(
      'https://local.test/other/',
      indexedDB,
      database.name,
    ).list(),
  ).toEqual([]);
  await database.blobs.put({ id: 'book-source', data: new Blob(['保留原书']) });
  await reopened.remove(id);
  expect(await reopened.list()).toEqual([]);
  expect((await database.blobs.get('book-source'))?.data.size).toBeGreaterThan(
    0,
  );
});
it('保留大小写敏感multipart边界，不依赖Blob.type的自动小写', async () => {
  const boundary = 'WebKitFormBoundaryABCxyz';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n字节保真\r\n--${boundary}--\r\n`;
  const type = 'multipart/form-data; boundary=' + boundary;
  await database.blobs.put({
    id: 'incoming:%2Freader%2F:' + id,
    data: new Blob([body], { type }),
    type,
  } as { id: string; data: Blob });
  expect((await store.get(id)).text).toBe('字节保真');
});
it('失败写入不覆盖已有分享；清空七表同时清除暂存，单份删除不碰正式书原文', async () => {
  await store.put(id, sample());
  const write = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementationOnce(function () {
      throw new DOMException('quota', 'QuotaExceededError');
    });
  await expect(
    store.put(id, { files: [], text: '替换失败', title: '', errors: [] }),
  ).rejects.toThrow('quota');
  write.mockRestore();
  expect((await store.get(id)).files.length).toBe(2);
  await clearAllData(database);
  expect(await store.list()).toEqual([]);
  await expect(store.get(id)).rejects.toThrow('已处理');
});
it('不创建不兼容的主库版本，损坏记录与恶意标识拒绝，已存数据不受影响', async () => {
  const unopened = createIncomingStore(
    scope,
    indexedDB,
    'incoming-uninitialized',
  );
  await expect(unopened.put(id, sample())).rejects.toThrow('先打开静页');
  expect(
    (await indexedDB.databases()).some(
      (value) => value.name === 'incoming-uninitialized',
    ),
  ).toBe(false);
  await expect(store.remove('../book-source')).rejects.toThrow('标识无效');
  const data = sample(),
    normalized = incomingData(incomingForm(data));
  expect(normalized.text).toBe(data.text);
});
it('待导入暂存不混进正式书架备份，也不泄漏到进度和笔记元数据', async () => {
  await store.put(id, sample());
  const snapshot = await createSnapshot('full', database);
  expect(snapshot.backup.books).toEqual([]);
  expect(snapshot.backup.files).toEqual([]);
  expect(snapshot.sources).toEqual([]);
  expect(JSON.stringify(snapshot.backup)).not.toContain('保留文字');
  expect((await store.get(id)).files.length).toBe(2);
});
it('主页面Dexie与SW原生暂存双向互通，文字换行及文件字节不变；失败不覆盖、仅删同一作用域', async () => {
  const client = createIncomingClient(scope, database);
  const data = { ...sample(), text: '第一行\n第二行\nhttps://example.test/' };
  await store.put(id, data);
  expect((await client.get(id)).text).toBe(data.text);
  expect(await client.list()).toEqual([id]);
  const replaced = { ...data, title: '新标题', text: data.text + '\n追加' };
  await client.put(id, replaced);
  const read = await store.get(id);
  expect(read.title).toBe(replaced.title);
  expect(read.text).toBe(replaced.text);
  expect(await read.files[1]!.arrayBuffer()).toEqual(
    await data.files[1]!.arrayBuffer(),
  );
  const put = vi
    .spyOn(database.blobs, 'put')
    .mockRejectedValueOnce(new Error('quota'));
  await expect(client.put(id, { ...data, text: '不应覆盖' })).rejects.toThrow(
    'quota',
  );
  put.mockRestore();
  expect((await store.get(id)).text).toBe(replaced.text);
  expect(
    await createIncomingClient('https://local.test/other/', database).list(),
  ).toEqual([]);
  await expect(client.remove('../bad')).rejects.toThrow('标识无效');
  await client.remove(id);
  expect(await store.list()).toEqual([]);
});
