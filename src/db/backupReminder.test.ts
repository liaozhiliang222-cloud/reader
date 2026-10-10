import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from './index';
import { annotationActivity, markBackupSaved } from './backupReminder';
import { saveSettings, loadSettings } from './settings';
import { initialSettings } from '@/app/defaults';
beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
it('所有划线与编辑过的笔记统计新旧时间，不把书签混入，删除后统计刷新', async () => {
  const base = {
    bookId: 'book',
    chapterIndex: 0,
    start: { paragraphIndex: 0, charOffset: 0 },
    end: { paragraphIndex: 0, charOffset: 1 },
    text: '甲',
    color: 'red' as const,
  };
  await db.highlights.bulkPut([
    { ...base, id: 'a', createdAt: 100, updatedAt: 200 },
    { ...base, id: 'b', createdAt: 300, updatedAt: 500, note: '编辑过的笔记' },
  ]);
  expect(await annotationActivity()).toEqual({ firstAt: 100, lastAt: 500 });
  await db.highlights.delete('b');
  expect(await annotationActivity()).toEqual({ firstAt: 100, lastAt: 200 });
  await db.highlights.clear();
  expect(await annotationActivity()).toEqual({});
});
it('记录快照时间不使用下载时间，旧快照不能回退新备份时间，并发设置不丢失', async () => {
  await db.settings.put({ id: 'global', value: initialSettings() });
  await Promise.all([
    markBackupSaved(1000),
    saveSettings({ autoResume: true, reading: { fontSize: 24 } }),
  ]);
  expect(await loadSettings()).toMatchObject({
    lastBackupAt: 1000,
    autoResume: true,
    reading: { fontSize: 24 },
  });
  await markBackupSaved(500);
  expect((await loadSettings()).lastBackupAt).toBe(1000);
  await markBackupSaved(2000);
  db.close();
  await db.open();
  expect((await loadSettings()).lastBackupAt).toBe(2000);
});
