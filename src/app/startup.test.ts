import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { fixturePayload, seed } from '@/backup/fixtures';
import { prepareBooks } from '@/backup/archive';
import { saveSettings } from '@/db/settings';
import { loadStartup } from './startup';
import { incomingStore } from './incoming';
let id = '';
beforeEach(async () => {
  vi.stubGlobal('location', { origin: 'https://local.test' });
  await db.open();
  const payload = await fixturePayload(1, false);
  await seed(db, await prepareBooks(payload), payload);
  id = payload.backup.books[0]!.id;
});
afterEach(async () => {
  await db.delete();
  vi.unstubAllGlobals();
});
it('数据库重新打开后无显式路由直接续读原书，预载单本设置，进度与笔记不改变', async () => {
  const progress = await db.progress.get(id),
    notes = await db.highlights.toArray();
  db.close();
  await db.open();
  const value = await loadStartup('');
  expect(value.hash).toBe('#/read/' + id);
  expect(value.book?.settingsOverride?.fontSize).toBe(22);
  expect(value.settings.reading.theme).toBe('night');
  expect(value.notice).toBe('');
  expect(await db.progress.get(id)).toEqual(progress);
  expect(await db.highlights.toArray()).toEqual(notes);
});
it('关闭续读或显式书架/设置/粘贴路由不被上次书籍覆盖', async () => {
  for (const hash of [
    '#/',
    '#/settings',
    '#/settings/backup',
    '#/paste',
    '#/incoming',
    '#/paste-share/uuid',
  ]) {
    const value = await loadStartup(hash);
    expect(value.hash).toBe(hash);
    expect(value.book).toBeUndefined();
  }
  await saveSettings({ autoResume: false });
  expect((await loadStartup('')).book).toBeUndefined();
});
it('已删除或缺原文件的上次书籍返回书架并给出提示，不删除原进度笔记', async () => {
  await db.books.update(id, { missingFile: true });
  expect(await loadStartup('')).toMatchObject({
    hash: '#/',
    book: undefined,
    notice: '这本书待补充原文件，请重新导入。',
  });
  expect(await db.progress.count()).toBe(1);
  expect(await db.highlights.count()).toBe(1);
  await db.books.delete(id);
  expect(await loadStartup('')).toMatchObject({
    hash: '#/',
    book: undefined,
    notice: '这本书已不存在。',
  });
});

it('原生重开清理旧错误页和已消费分享路由，网页显式错误页保持可见', async () => {
  for (const hash of [
    '#/incoming',
    '#/incoming/error-size',
    '#/incoming/error-storage',
    '#/incoming/fa8d2d71-7a48-4b44-8bd3-c4d000e6ae84',
  ]) {
    expect((await loadStartup(hash, true)).hash).toBe('#/');
    expect((await loadStartup(hash)).hash).toBe(hash);
  }
});

it('原生重开仍可处理失败分享，检查启动不删除文件或错误记录', async () => {
  const incomingId = 'fa8d2d71-7a48-4b44-8bd3-c4d000e6ae84';
  const data = {
    files: [new File(['bad'], '损坏.epub')],
    text: '',
    title: '',
    errors: ['上次文件读取失败'],
  };
  const store = incomingStore();
  await store.put(incomingId, data);
  const hash = '#/incoming/' + incomingId;
  expect((await loadStartup(hash, true)).hash).toBe(hash);
  const pending = await store.get(incomingId);
  expect(pending.errors).toEqual(data.errors);
  expect(await pending.files[0]!.text()).toBe('bad');
});
