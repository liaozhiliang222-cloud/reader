// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentsDrawer } from './ContentsDrawer';
import type { Book } from '@/types';
const root = document.createElement('div');
const frames = new Map<number, FrameRequestCallback>();
let id = 0;
const chapters = Array.from({ length: 1000 }, (_, index) => ({
  index,
  title: '第' + index + '章',
  charStart: index * 100,
  charCount: 100,
}));
const book: Book = {
  id: 'toc',
  title: '千章',
  type: 'txt',
  size: 300000,
  chapterCount: 1000,
  charCount: 100000,
  importedAt: 1,
  lastReadAt: 1,
};
afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  frames.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function frame() {
  const tasks = [...frames.values()];
  frames.clear();
  await act(() => {
    tasks.forEach((task) => task(0));
  });
}
function button(index: number) {
  return root.querySelector<HTMLButtonElement>(
    `[data-toc-index="${index}"] button`,
  )!;
}
async function key(value: string) {
  await act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await frame();
}
it('千章目录只挂载视口行，首尾键、方向键和Tab可越过窗口，保持焦点及跳转位置', async () => {
  vi.stubGlobal('requestAnimationFrame', (task: FrameRequestCallback) => {
    frames.set(++id, task);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  )!;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('toc-viewport')
        ? 480
        : descriptor.get!.call(this);
    },
  );
  document.body.append(root);
  const jump = vi.fn();
  await act(() =>
    render(
      createElement(ContentsDrawer, {
        book,
        chapters,
        locator: { chapterIndex: 500, paragraphIndex: 0, charOffset: 0 },
        bookmarks: [],
        highlights: [],
        onEditNote: vi.fn(),
        onJumpHighlight: vi.fn(),
        currentBookmarkIds: [],
        onRemoveBookmark: vi.fn(),
        onClose: vi.fn(),
        onJump: jump,
      }),
      root,
    ),
  );
  // Navigate before the initial centering frame has had a chance to run.
  await act(() => button(0).focus());
  await key('End');
  expect(document.activeElement).toBe(button(999));
  const viewport = root.querySelector<HTMLElement>('.toc-viewport')!;
  expect(viewport.scrollTop).toBe(999 * 56);
  await act(() => {
    viewport.scrollTop = 500 * 56 - 240;
    viewport.dispatchEvent(new Event('scroll'));
  });
  await frame();
  expect(root.querySelectorAll('[data-toc-index]').length).toBeLessThanOrEqual(
    19,
  );
  expect(button(500).getAttribute('aria-current')).toBe('location');
  await act(() => button(500).focus());
  await key('End');
  expect(document.activeElement).toBe(button(999));
  expect(button(999).closest('li')?.getAttribute('aria-posinset')).toBe('1000');
  await act(() => button(999).click());
  expect(jump).toHaveBeenCalledWith({
    chapterIndex: 999,
    paragraphIndex: 0,
    charOffset: 0,
  });
  await act(() => {
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
  });
  expect(document.activeElement).toBe(button(999));
  expect(root.querySelectorAll('[data-toc-index]').length).toBeLessThanOrEqual(
    19,
  );
  await key('Home');
  expect(document.activeElement).toBe(button(0));
  for (let index = 0; index < 25; index++) await key('Tab');
  expect(document.activeElement).toBe(button(25));
  await key('ArrowUp');
  expect(document.activeElement).toBe(button(24));
  await act(() => render(null, root));
  expect(disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
});
