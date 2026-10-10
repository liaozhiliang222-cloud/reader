import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from './index';
import { loadSettings, saveSettings, saveBookSettings } from './settings';
import { saveBook, getBook } from './repository';
beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
it('并发更新全局不同字段不会相互覆盖，重开数据库仍可恢复', async () => {
  await Promise.all([
    saveSettings({ reading: { fontSize: 24 } }),
    saveSettings({ autoResume: true }),
    saveSettings({ reading: { theme: 'night' } }),
    saveSettings({ shelfSort: 'title' }),
  ]);
  db.close();
  await db.open();
  const value = await loadSettings();
  expect(value.autoResume).toBe(true);
  expect(value.reading.fontSize).toBe(24);
  expect(value.reading.theme).toBe('night');
  expect(value.reading.lineHeight).toBe(1.8);
  expect(value.shelfSort).toBe('title');
});
it('单本排版仅合并本书覆盖值，不改全局', async () => {
  await saveBook(
    {
      id: 'a',
      title: 'A',
      type: 'txt',
      charCount: 1,
      chapterCount: 1,
      importedAt: 1,
      lastReadAt: 1,
      size: 1,
    },
    [],
    new Blob(['a']),
  );
  await Promise.all([
    saveBookSettings('a', { fontSize: 28 }),
    saveBookSettings('a', { theme: 'green' }),
  ]);
  expect((await getBook('a'))?.settingsOverride).toEqual({
    fontSize: 28,
    theme: 'green',
    lightTheme: 'green',
  });
  expect((await loadSettings()).reading.fontSize).toBe(18);
  await expect(saveBookSettings('missing', { fontSize: 20 })).rejects.toThrow(
    '书籍不存在',
  );
});
it('旧版排版缺少安静提示时补默认值，关闭后重开数据库仍恢复', async () => {
  await saveSettings({ reading: { fontSize: 24 } });
  const record = (await db.settings.get('global'))!;
  const old: Partial<typeof record.value.reading> = { ...record.value.reading };
  delete old.quietHint;
  await db.settings.put({
    ...record,
    value: { ...record.value, reading: old as typeof record.value.reading },
  });
  expect((await loadSettings()).reading.quietHint).toBe(true);
  await saveSettings({ reading: { quietHint: false } });
  db.close();
  await db.open();
  expect((await loadSettings()).reading).toMatchObject({
    quietHint: false,
    fontSize: 24,
  });
});
it('全局和单本记住所选浅色，手动夜读和跟随开关不覆盖，重开仍恢复', async () => {
  await saveSettings({ reading: { theme: 'green' } });
  await saveSettings({ reading: { theme: 'night' }, followSystemTheme: true });
  db.close();
  await db.open();
  expect(await loadSettings()).toMatchObject({
    followSystemTheme: true,
    reading: { theme: 'night', lightTheme: 'green' },
  });
  await saveBook(
    {
      id: 'a',
      title: 'A',
      type: 'txt',
      charCount: 1,
      chapterCount: 1,
      importedAt: 1,
      lastReadAt: 1,
      size: 1,
    },
    [],
    new Blob(['a']),
  );
  await saveBookSettings('a', { theme: 'eink' });
  await saveBookSettings('a', { theme: 'night' });
  expect((await getBook('a'))?.settingsOverride).toEqual({
    theme: 'night',
    lightTheme: 'eink',
  });
  await saveSettings({ followSystemTheme: false });
  expect((await loadSettings()).reading).toMatchObject({
    theme: 'night',
    lightTheme: 'green',
  });
});
it('旧设置只有浅色主题而无历史字段，首次切夜读仍记住原选择；单本继承全局浅色', async () => {
  const value = await loadSettings();
  value.reading.theme = 'green';
  delete value.reading.lightTheme;
  await db.settings.put({ id: 'global', value });
  await saveSettings({ reading: { theme: 'night' } });
  expect((await loadSettings()).reading.lightTheme).toBe('green');
  await saveSettings({ reading: { theme: 'eink' } });
  await saveBook(
    {
      id: 'a',
      title: 'A',
      type: 'txt',
      charCount: 1,
      chapterCount: 1,
      importedAt: 1,
      lastReadAt: 1,
      size: 1,
    },
    [],
    new Blob(['a']),
  );
  await saveBookSettings('a', { theme: 'night' });
  expect((await getBook('a'))?.settingsOverride).toEqual({
    theme: 'night',
    lightTheme: 'eink',
  });
});
