// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackupReminder } from './BackupReminder';
import { db } from '@/db';
import { settings, initialSettings } from '@/app/settings';
import { BACKUP_PERIOD as period } from '@/app/backupReminder';
import * as storage from '@/db/settings';

const root = document.createElement('div');
document.body.append(root);
let now = 1001 + period;
beforeEach(async () => {
  await db.open();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  now = 1001 + period;
  settings.value = await storage.saveSettings({ lastBackupAt: 1000 });
  await db.highlights.put({
    id: 'h',
    bookId: 'book',
    chapterIndex: 0,
    start: { paragraphIndex: 0, charOffset: 0 },
    end: { paragraphIndex: 0, charOffset: 1 },
    text: '甲',
    color: 'red',
    createdAt: 100,
    updatedAt: 2000,
  });
});
afterEach(async () => {
  await act(() => render(null, root));
  vi.restoreAllMocks();
  settings.value = initialSettings();
  await db.delete();
});
async function mount() {
  await act(() => render(createElement(BackupReminder, { revision: 0 }), root));
  await vi.waitFor(() => expect(root.querySelector('aside')).not.toBeNull());
}
async function click(text: string) {
  const button = [...root.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  )!;
  await act(() => button.click());
}
it('提示仅在书架组件显示，可直达备份，关闭后重开数据库仍不提示，下周期重新出现', async () => {
  await mount();
  await click('去备份');
  expect(location.hash).toBe('#/settings/backup');
  await click('本周期不再提醒');
  await vi.waitFor(() => expect(root.querySelector('aside')).toBeNull());
  await act(() => render(null, root));
  db.close();
  await db.open();
  settings.value = await storage.loadSettings();
  await act(() => render(createElement(BackupReminder, { revision: 0 }), root));
  expect(root.querySelector('aside')).toBeNull();
  now = 1000 + 2 * period;
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await vi.waitFor(() => expect(root.querySelector('aside')).not.toBeNull());
});
it('关闭保存失败保留提示和重试按钮，保存新快照后提示消失，设置其他字段仍在', async () => {
  await mount();
  vi.spyOn(storage, 'saveSettings').mockRejectedValueOnce(new Error('quota'));
  await click('本周期不再提醒');
  expect(root.textContent).toContain('未能保存');
  expect(root.querySelector('aside')).not.toBeNull();
  await click('本周期不再提醒');
  await vi.waitFor(() => expect(root.querySelector('aside')).toBeNull());
  settings.value = await storage.saveSettings({
    lastBackupAt: 3000,
    reading: { fontSize: 24 },
  });
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(root.querySelector('aside')).toBeNull();
  expect(settings.value.reading.fontSize).toBe(24);
});
it('系统时间改变后重返页面会重新判断，撤销未来日期后不持续显示过期提示', async () => {
  now = 1000 + period;
  await act(() => render(createElement(BackupReminder, { revision: 0 }), root));
  await act(async () => {
    await db.highlights.count();
  });
  expect(root.querySelector('aside')).toBeNull();
  now += 1;
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await vi.waitFor(() => expect(root.querySelector('aside')).not.toBeNull());
  now = 500;
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(root.querySelector('aside')).toBeNull();
});
