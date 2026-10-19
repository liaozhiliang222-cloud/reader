// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { Onboarding } from './Onboarding';
import { SettingsPage } from '@/pages/Settings/SettingsPage';
import { EnvironmentNotice } from '@/components/EnvironmentNotice';
import { db } from '@/db/index';
import { initialSettings, settings } from '@/app/settings';
import { installState } from '@/app/install';
import * as storedSettings from '@/db/settings';

vi.mock('@/app/storage', () => ({
  requestPersistence: vi.fn(),
  storageInfo: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/app/pwa', async () => {
  const { signal } = await import('@preact/signals');
  return { startPwa: vi.fn(), checkPwaUpdate: vi.fn(), pwaState: signal({}) };
});
vi.mock('@/app/fileLaunch', () => ({ installFileConsumer: vi.fn() }));
vi.mock('@/pages/Bookshelf/BookshelfPage', () => ({
  BookshelfPage: () => createElement('p', null, '书架可用'),
}));
vi.mock('@/pages/Import/IncomingPage', () => ({
  IncomingPage: ({ id }: { id: string }) =>
    createElement('p', null, '分享接收：' + id),
}));
vi.mock('@/pages/Reader/ReaderView', () => ({
  ReaderView: () => createElement('p', null, '正文可用'),
}));
const root = document.createElement('div');
document.body.append(root);
async function click(text: string) {
  const button = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  );
  expect(button, text).toBeDefined();
  await act(() => button!.click());
}
beforeEach(async () => {
  settings.value = initialSettings();
  installState.value = {
    available: false,
    installed: false,
    pending: false,
    message: '',
  };
  history.replaceState(null, '', '#/');
  await db.open();
});
afterEach(async () => {
  await act(() => render(null, root));
  vi.restoreAllMocks();
  await db.delete();
});
it('首次显示三屏，可跳过并持久化；重开数据库再启动不会重复，分享目的路由保留', async () => {
  const id = '74e9272b-aa39-402f-ae4b-18e35ec5d67f';
  history.replaceState(null, '', '#/incoming/' + id);
  await act(() => render(createElement(App, null), root));
  await vi.waitFor(() =>
    expect(root.textContent).toContain('你的书只在这台设备上'),
  );
  expect(root.textContent).not.toContain('分享接收：');
  expect(location.hash).toBe('#/incoming/' + id);
  await click('跳过引导');
  await vi.waitFor(() => expect(root.textContent).toContain('分享接收：' + id));
  expect((await storedSettings.loadSettings()).onboarded).toBe(true);
  await act(() => render(null, root));
  db.close();
  await db.open();
  await act(() => render(createElement(App, null), root));
  await vi.waitFor(() => expect(root.textContent).toContain('分享接收：' + id));
  expect(root.querySelector('.onboarding')).toBeNull();
});
it('三个屏幕可前后浏览，完成后只更新引导标志，不丢失已有排版及阅读习惯', async () => {
  await storedSettings.saveSettings({
    reading: { fontSize: 24 },
    autoResume: true,
  });
  const done = vi.fn();
  await act(() =>
    render(createElement(Onboarding, { first: true, onDone: done }), root),
  );
  await click('下一步');
  expect(root.querySelector('h1')?.textContent).toBe('添加到主屏幕');
  expect(document.activeElement).toBe(root.querySelector('h1'));
  await click('上一步');
  expect(root.querySelector('.guide-step')?.textContent).toContain('1 / 3');
  await click('下一步');
  await click('下一步');
  expect(root.querySelector('h1')?.textContent).toContain('勿扰模式');
  await click('开始使用');
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(await storedSettings.loadSettings()).toMatchObject({
    onboarded: true,
    autoResume: true,
    reading: { fontSize: 24 },
  });
});
it('设置页可重新打开和关闭引导，复看不改持久化设置', async () => {
  settings.value = await storedSettings.saveSettings({ onboarded: true });
  const save = vi.spyOn(storedSettings, 'saveSettings');
  await act(() => render(createElement(SettingsPage, null), root));
  await click('查看使用引导与安装方法');
  expect(root.querySelector('dialog')?.open).toBe(true);
  expect(root.textContent).toContain('你的书只在这台设备上');
  await click('关闭引导');
  expect(root.querySelector('dialog')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
it('保存失败不虚报首次标志，可本次先阅读；忙碌时禁止再次跳过', async () => {
  const done = vi.fn();
  let reject!: (error: Error) => void;
  vi.spyOn(storedSettings, 'saveSettings').mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await act(() =>
    render(createElement(Onboarding, { first: true, onDone: done }), root),
  );
  await click('跳过引导');
  expect(
    [...root.querySelectorAll('button')].every((node) => node.disabled),
  ).toBe(true);
  expect(done).not.toHaveBeenCalled();
  await act(() => reject(new Error('quota')));
  await vi.waitFor(() => expect(root.textContent).toContain('记录未能保存'));
  expect((await storedSettings.loadSettings()).onboarded).toBe(false);
  await click('本次先阅读');
  expect(done).toHaveBeenCalledOnce();
});
it('iOS 提供本地三步图示和文件导入说明，已安装后不重复显示安装引导', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'iPhone OS 17_0 like Mac OS X Safari/605',
  );
  const done = vi.fn();
  await act(() => render(createElement(Onboarding, { onDone: done }), root));
  await click('下一步');
  expect(root.querySelectorAll('.install-steps li').length).toBe(3);
  expect(root.textContent).toContain('文件');
  expect(root.textContent).toContain('作为网页 App 打开');
  expect(
    [...root.querySelectorAll('img')].every((image) =>
      image.getAttribute('src')?.startsWith('/icons/'),
    ),
  ).toBe(true);
  await act(() => {
    installState.value = { ...installState.value, installed: true };
  });
  expect(root.querySelector('.install-steps')).toBeNull();
  expect(root.textContent).toContain('已安装');
  expect(root.textContent).toContain('从“文件”选择');
});
it('内置浏览器有可关闭提示；无安装事件只提供菜单说明，不显示可用安装按钮', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Linux Android MicroMessenger/8.0',
  );
  await act(() => render(createElement(EnvironmentNotice, null), root));
  expect(root.textContent).toContain('微信内置浏览器');
  expect(root.textContent).toContain('系统浏览器');
  await click('知道了');
  expect(root.querySelector('aside')).toBeNull();
  await act(() => render(createElement(Onboarding, { onDone: vi.fn() }), root));
  await click('下一步');
  expect(root.textContent).toContain('浏览器菜单');
  expect(
    [...root.querySelectorAll('button')].some(
      (node) => node.textContent === '安装微光阅读',
    ),
  ).toBe(false);
});
