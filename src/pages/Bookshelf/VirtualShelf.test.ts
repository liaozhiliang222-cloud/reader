// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { VirtualShelf, SHELF_ROW_HEIGHT as rowHeight } from './VirtualShelf';
import { getBlob } from '@/db/repository';
import type { ShelfEntry } from './model';

vi.mock('@/db/repository', () => ({ getBlob: vi.fn() }));
const entries: ShelfEntry[] = Array.from({ length: 100 }, (_, index) => ({
  book: {
    id: String(index),
    title: '长书名'.repeat(30) + index,
    type: 'txt',
    coverBlobId: 'cover-' + index,
    charCount: 100000,
    chapterCount: 1000,
    size: 300000,
    importedAt: 1,
    lastReadAt: 1,
  },
}));
let root: HTMLDivElement,
  scroll = 0,
  sequence = 0;
const frames = new Map<number, FrameRequestCallback>();
const disconnected = vi.fn(),
  read = vi.fn(),
  actions = vi.fn();
async function frame() {
  const tasks = [...frames.values()];
  frames.clear();
  await act(() => {
    tasks.forEach((task) => task(0));
  });
}
function button(index: number, more = false) {
  return root.querySelector<HTMLButtonElement>(
    `[data-shelf-index="${index}"] .${more ? 'shelf-more' : 'shelf-entry'}`,
  )!;
}
async function key(value: string, shiftKey = false) {
  await act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await frame();
}
beforeEach(async () => {
  scroll = 0;
  frames.clear();
  read.mockClear();
  actions.mockClear();
  disconnected.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {
        disconnected();
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (task: FrameRequestCallback) => {
    frames.set(++sequence, task);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const bounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('virtual-shelf')
        ? new DOMRect(0, -scroll, 390, entries.length * rowHeight)
        : bounds.call(this);
    },
  );
  let url = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    () => 'blob:cover-' + url++,
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.mocked(getBlob)
    .mockReset()
    .mockImplementation((id) =>
      Dexie.Promise.resolve({
        id,
        bookId: '',
        data: new Blob(['image'], { type: 'image/png' }),
      }),
    );
  root = document.createElement('div');
  document.body.append(root);
  await act(() =>
    render(
      createElement(VirtualShelf, {
        entries,
        onRead: read,
        onActions: actions,
      }),
      root,
    ),
  );
  await frame();
});
afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  frames.clear();
});
it('百本书只挂载视口行，滚至末尾保持操作ID及列表位置，并释放淘汰封面', async () => {
  expect(root.querySelectorAll('li').length).toBeLessThanOrEqual(10);
  const loaded = vi.mocked(URL.createObjectURL).mock.calls.length;
  scroll = rowHeight * 95;
  window.dispatchEvent(new Event('scroll'));
  await frame();
  expect(button(0)).toBeNull();
  expect(root.querySelectorAll('li').length).toBeLessThanOrEqual(12);
  expect(button(99).closest('li')?.getAttribute('aria-posinset')).toBe('100');
  expect(button(99).closest('li')?.getAttribute('aria-setsize')).toBe('100');
  await act(() => {
    button(99).click();
    button(99, true).click();
  });
  expect(read).toHaveBeenCalledWith(entries[99]!.book);
  expect(actions).toHaveBeenCalledWith(entries[99]!.book);
  expect(
    vi.mocked(URL.revokeObjectURL).mock.calls.length,
  ).toBeGreaterThanOrEqual(loaded ?? 1);
});
it('键盘Tab、方向键和首尾跳转跨虚拟窗口，聚焦行不会随滚动消失', async () => {
  await act(() => button(0).focus());
  await key('Tab');
  expect(document.activeElement).toBe(button(0, true));
  await key('Tab');
  expect(document.activeElement).toBe(button(1));
  await key('End');
  expect(document.activeElement).toBe(button(99));
  await key('Tab');
  expect(document.activeElement).toBe(button(99, true));
  await key('Tab', true);
  expect(document.activeElement).toBe(button(99));
  scroll = 0;
  window.dispatchEvent(new Event('scroll'));
  await frame();
  expect(document.activeElement).toBe(button(99));
  expect(root.querySelectorAll('li').length).toBeLessThanOrEqual(11);
  await key('Home');
  expect(document.activeElement).toBe(button(0));
  await key('ArrowDown');
  expect(document.activeElement).toBe(button(1));
});
it('虚拟行淘汰取消未完成长按，卸载取消监听、帧和全部封面URL', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  button(0).dispatchEvent(
    new PointerEvent('pointerdown', { button: 0, bubbles: true }),
  );
  scroll = rowHeight * 95;
  window.dispatchEvent(new Event('scroll'));
  await frame();
  await act(() => {
    vi.advanceTimersByTime(600);
  });
  expect(actions).not.toHaveBeenCalled();
  const count = vi.mocked(URL.createObjectURL).mock.calls.length;
  await act(() => render(null, root));
  expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(count);
  expect(disconnected).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event('scroll'));
  expect(frames.size).toBe(0);
});
