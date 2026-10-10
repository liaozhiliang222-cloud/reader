import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { fixturePayload, seed } from '@/backup/fixtures';
import { prepareBooks } from '@/backup/archive';
import { saveSettings } from '@/db/settings';
import { loadStartup } from './startup';
let id = '';
beforeEach(async () => {
  await db.open();
  const payload = await fixturePayload(1, false);
  await seed(db, await prepareBooks(payload), payload);
  id = payload.backup.books[0]!.id;
});
afterEach(async () => {
  await db.delete();
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
