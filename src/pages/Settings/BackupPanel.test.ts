// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackupPanel } from './BackupPanel';
import { db } from '@/db';
import { settings, initialSettings } from '@/app/settings';
import * as files from '@/app/files';
import * as generated from '@/backup/client';
import { loadSettings } from '@/db/settings';
vi.mock('@/app/files', () => ({ downloadBlob: vi.fn(), shareBlob: vi.fn() }));
vi.mock('@/backup/client', () => ({
  generateFullBackup: vi.fn(),
  inspectBackup: vi.fn(),
  restoreFromBackup: vi.fn(),
}));
const root = document.createElement('div');
document.body.append(root);
let now = 1000;
beforeEach(async () => {
  await db.open();
  settings.value = initialSettings();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  now = 1000;
  vi.mocked(files.downloadBlob).mockReset();
  vi.mocked(files.shareBlob).mockReset().mockResolvedValue(undefined);
  vi.mocked(generated.generateFullBackup)
    .mockReset()
    .mockResolvedValue(new Blob(['zip']));
  vi.stubGlobal('navigator', { share: vi.fn().mockResolvedValue(undefined) });
  await act(() =>
    render(createElement(BackupPanel, { onBusy: vi.fn() }), root),
  );
});
afterEach(async () => {
  await act(() => render(null, root));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
  settings.value = initialSettings();
});
async function click(text: string) {
  const button = [...root.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  )!;
  expect(button, text).toBeDefined();
  await act(() => button.click());
}
it.each(['轻量', '完整'])(
  '%s备份生成不记录已保存；晚些时候下载仅记生成快照时间',
  async (kind) => {
    await click(`生成${kind}备份`);
    await vi.waitFor(() =>
      expect(root.querySelector('.backup-ready')).not.toBeNull(),
    );
    expect((await loadSettings()).lastBackupAt).toBeUndefined();
    now = 2000;
    await click('下载备份');
    await vi.waitFor(async () =>
      expect((await loadSettings()).lastBackupAt).toBe(1000),
    );
    expect(files.downloadBlob).toHaveBeenCalledOnce();
    expect(settings.value.lastBackupAt).toBe(1000);
  },
);
it('取消分享或下载失败不记备份成功，保留已生成文件可重试', async () => {
  await click('生成轻量备份');
  await vi.waitFor(() =>
    expect(root.querySelector('.backup-ready')).not.toBeNull(),
  );
  vi.mocked(files.shareBlob).mockRejectedValueOnce(
    new DOMException('cancel', 'AbortError'),
  );
  await click('分享备份');
  expect((await loadSettings()).lastBackupAt).toBeUndefined();
  vi.mocked(files.downloadBlob).mockImplementationOnce(() => {
    throw new Error('保存失败');
  });
  await click('下载备份');
  expect(root.textContent).toContain('保存失败');
  expect((await loadSettings()).lastBackupAt).toBeUndefined();
  await click('下载备份');
  await vi.waitFor(async () =>
    expect((await loadSettings()).lastBackupAt).toBe(1000),
  );
});
