// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { usePresence, useReducedMotion } from './usePresence';
const root = document.createElement('div');
document.body.append(root);
function Panel({ open, duration }: { open: boolean; duration: number }) {
  const reduced = useReducedMotion();
  return usePresence(open, duration, reduced)
    ? createElement(
        'div',
        { inert: !open, 'aria-hidden': !open || undefined },
        '浮层',
      )
    : null;
}
afterEach(() => {
  act(() => render(null, root));
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('关闭期间保留不可交互浮层，到时卸载；快速重新打开取消旧卸载计时', async () => {
  vi.useFakeTimers();
  await act(() =>
    render(createElement(Panel, { open: true, duration: 180 }), root),
  );
  await act(() =>
    render(createElement(Panel, { open: false, duration: 180 }), root),
  );
  expect(root.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  expect((root.firstElementChild as HTMLElement).inert).toBe(true);
  await act(() => {
    vi.advanceTimersByTime(179);
  });
  expect(root.textContent).toBe('浮层');
  await act(() =>
    render(createElement(Panel, { open: true, duration: 180 }), root),
  );
  await act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(root.textContent).toBe('浮层');
  expect(root.firstElementChild?.getAttribute('aria-hidden')).toBeNull();
  await act(() =>
    render(createElement(Panel, { open: false, duration: 180 }), root),
  );
  await act(() => {
    vi.advanceTimersByTime(180);
  });
  expect(root.textContent).toBe('');
});
it('实时开启减弱动态会立即卸载关闭中的抽屉，并释放媒体和计时监听', async () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  let matches = false;
  const remove = vi.fn(events.removeEventListener.bind(events));
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    get matches() {
      return matches;
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: remove,
  } as unknown as MediaQueryList);
  await act(() =>
    render(createElement(Panel, { open: true, duration: 240 }), root),
  );
  await act(() =>
    render(createElement(Panel, { open: false, duration: 240 }), root),
  );
  await act(() => {
    matches = true;
    events.dispatchEvent(new Event('change'));
  });
  expect(root.textContent).toBe('');
  expect(vi.getTimerCount()).toBe(0);
  await act(() => render(null, root));
  expect(remove).toHaveBeenCalledOnce();
});
