// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { useBackClose } from './useBackClose';

const root = document.createElement('div');
document.body.append(root);
let api: {
  menu: boolean;
  drawer: boolean;
  setMenu: (value: boolean) => void;
  setDrawer: (value: boolean) => void;
  leave: (action: () => void) => void;
};
function Harness() {
  const [menu, setMenu] = useState(false),
    [drawer, setDrawer] = useState(false);
  const leave = useBackClose(menu || drawer, () => {
    if (drawer) setDrawer(false);
    else setMenu(false);
  });
  api = { menu, drawer, setMenu, setDrawer, leave };
  return null;
}
const popped = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('popstate', () => setTimeout(resolve), {
      once: true,
    }),
  );
afterEach(() => {
  render(null, root);
  history.replaceState(null, '', '#/');
});
it('返回键逐层关闭浮层，最后才离开阅读页', async () => {
  history.replaceState(null, '', '#/read/x');
  await act(() => render(createElement(Harness, null), root));
  const base = history.length;
  await act(() => api.setMenu(true));
  await act(() => api.setDrawer(true));
  expect(history.length).toBe(base + 1);
  let wait = popped();
  await act(async () => {
    history.back();
    await wait;
  });
  expect(api).toMatchObject({ drawer: false, menu: true });
  expect(location.hash).toBe('#/read/x');
  wait = popped();
  await act(async () => {
    history.back();
    await wait;
  });
  expect(api).toMatchObject({ drawer: false, menu: false });
  expect(location.hash).toBe('#/read/x');
});
it('界面内关闭会撤回历史记录，离开时先撤回再执行导航', async () => {
  history.replaceState(null, '', '#/read/x');
  await act(() => render(createElement(Harness, null), root));
  await act(() => api.setMenu(true));
  expect(history.state).toMatchObject({ jingyeOverlay: expect.any(String) });
  let wait = popped();
  await act(() => api.setMenu(false));
  await act(() => wait);
  expect(history.state).toBeNull();
  expect(api.menu).toBe(false);
  await act(() => api.setMenu(true));
  const action = vi.fn();
  wait = popped();
  await act(async () => {
    api.leave(action);
    await wait;
  });
  expect(action).toHaveBeenCalledOnce();
  expect(history.state).toBeNull();
});
