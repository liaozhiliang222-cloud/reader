// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { db } from '@/db';
import { settings, initialSettings } from '@/app/settings';
import { fixturePayload, seed } from '@/backup/fixtures';
import { prepareBooks } from '@/backup/archive';
import { loadSettings } from '@/db/settings';
const root = document.createElement('div');
document.body.append(root);
afterEach(async () => {
  act(() => render(null, root));
  await db.delete();
  settings.value = initialSettings();
});
it('备份提醒入口聚焦备份区域，跟随系统开关保存后主题选项呈现浅色选择', async () => {
  await db.open();
  await act(() =>
    render(createElement(SettingsPage, { initialSection: 'backup' }), root),
  );
  const section = root.querySelector<HTMLElement>(
    'section[aria-label="备份与恢复"]',
  )!;
  expect(document.activeElement).toBe(section);
  const follow = [
    ...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'),
  ].find((input) =>
    input.parentElement?.textContent?.includes('跟随系统深色'),
  )!;
  await act(() => follow.click());
  await vi.waitFor(async () =>
    expect((await loadSettings()).followSystemTheme).toBe(true),
  );
  const lightThemes = () =>
    [...root.querySelectorAll('fieldset.theme-swatches')].find(
      (group) => group.querySelector('legend')?.textContent === '浅色主题',
    );
  await vi.waitFor(() => expect(lightThemes()).toBeDefined());
  expect(
    [...lightThemes()!.querySelectorAll<HTMLInputElement>('input')].map(
      (item) => item.value,
    ),
  ).toEqual(['paper', 'eink', 'green']);
});
it('清空必须输入正确确认词，提交前不删除数据，成功后七表为空并恢复默认设置', async () => {
  await db.open();
  const payload = await fixturePayload();
  await seed(db, await prepareBooks(payload), payload);
  settings.value = payload.backup.settings;
  await act(() => render(createElement(SettingsPage, {}), root));
  const trigger = [...root.querySelectorAll('button')].find(
    (b) => b.textContent === '清空所有数据',
  )!;
  await act(() => trigger.click());
  await vi.waitFor(() => expect(root.querySelector('dialog')).not.toBeNull());
  const input = root.querySelector<HTMLInputElement>('.clear-confirm input')!;
  const submit = [...root.querySelectorAll('button')].find(
    (b) => b.textContent === '确认清空',
  )!;
  expect(submit.disabled).toBe(true);
  expect(await db.books.count()).toBe(3);
  await act(() => {
    input.value = '删除';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(submit.disabled).toBe(true);
  await act(() => submit.click());
  expect(await db.books.count()).toBe(3);
  await act(() => {
    input.value = '清空';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(submit.disabled).toBe(false);
  await act(() => submit.click());
  await vi.waitFor(() => expect(root.querySelector('dialog')).toBeNull());
  for (const table of db.tables) expect(await table.count()).toBe(0);
  expect(settings.value).toEqual(initialSettings());
});
