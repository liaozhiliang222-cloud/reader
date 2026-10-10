// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { QuietHint } from './QuietHint';
const root = document.createElement('div');
document.body.append(root);
afterEach(() => {
  act(() => render(null, root));
  vi.useRealTimers();
});
it('进入阅读仅显示两秒，关闭立即隐藏且取消计时，重新开启可显示；卸载清理', async () => {
  vi.useFakeTimers();
  await act(() => render(createElement(QuietHint, { enabled: true }), root));
  expect(root.textContent).toContain('已进入安静阅读');
  await act(() => {
    vi.advanceTimersByTime(1999);
  });
  expect(root.textContent).toContain('已进入安静阅读');
  await act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(root.textContent).toBe('');
  await act(() => render(createElement(QuietHint, { enabled: false }), root));
  await act(() => render(createElement(QuietHint, { enabled: true }), root));
  expect(root.textContent).toContain('已进入安静阅读');
  await act(() => render(createElement(QuietHint, { enabled: false }), root));
  expect(root.textContent).toBe('');
  expect(vi.getTimerCount()).toBe(0);
  await act(() => render(createElement(QuietHint, { enabled: true }), root));
  await act(() => render(null, root));
  expect(vi.getTimerCount()).toBe(0);
});
