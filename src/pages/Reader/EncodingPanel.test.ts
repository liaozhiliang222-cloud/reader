// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EncodingPanel } from './EncodingPanel';
import * as parsing from '@/parsers/recodeText';
import * as stored from '@/db/recode';
import { splitChapters } from '@/parsers/txt/chapters';
import type { Book } from '@/types';

vi.mock('@/parsers/recodeText', async (original) => ({
  ...(await original<typeof parsing>()),
  previewEncoding: vi.fn(),
}));
vi.mock('@/db/recode', () => ({ applyEncoding: vi.fn() }));
const root = document.createElement('div');
document.body.append(root);
const book: Book = {
  id: 'a'.repeat(64),
  title: '书',
  type: 'txt',
  encoding: 'gb18030',
  charCount: 4,
  chapterCount: 1,
  importedAt: 1,
  lastReadAt: 1,
  size: 4,
};
const parsed = {
  id: book.id,
  encoding: 'big5',
  chapters: splitChapters('中文閱讀'),
  charCount: 4,
};
const close = vi.fn(),
  applied = vi.fn();
async function click(text: string) {
  const button = [...root.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  )!;
  expect(button, text).toBeDefined();
  await act(() => button.click());
}
beforeEach(async () => {
  vi.mocked(parsing.previewEncoding).mockReset().mockResolvedValue(parsed);
  vi.mocked(stored.applyEncoding)
    .mockReset()
    .mockResolvedValue({ ...book, encoding: 'big5', contentRevision: 1 });
  close.mockClear();
  applied.mockClear();
  await act(() =>
    render(
      createElement(EncodingPanel, {
        book,
        percent: 75,
        onClose: close,
        onApplied: applied,
      }),
      root,
    ),
  );
});
afterEach(async () => {
  await act(() => render(null, root));
});
it('必须预览再确认，切换选项会使旧预览失效；应用后通知阅读器重开同一本书', async () => {
  const apply = () =>
    [...root.querySelectorAll('button')].find(
      (item) => item.textContent === '确认切换',
    )!;
  expect(apply().disabled).toBe(true);
  await click('预览正文');
  expect(root.querySelector('.encoding-preview')?.textContent).toContain(
    '中文閱讀',
  );
  expect(stored.applyEncoding).not.toHaveBeenCalled();
  const select = root.querySelector('select')!;
  await act(() => {
    select.value = 'big5';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(root.querySelector('.encoding-preview')).toBeNull();
  expect(apply().disabled).toBe(true);
  await click('预览正文');
  expect(parsing.previewEncoding).toHaveBeenLastCalledWith(
    book,
    'big5',
    expect.any(AbortSignal),
  );
  await click('确认切换');
  expect(stored.applyEncoding).toHaveBeenCalledWith(book, parsed, 75);
  expect(applied).toHaveBeenCalledWith(
    expect.objectContaining({ id: book.id, contentRevision: 1 }),
  );
});
it('解码或保存失败留在对话框，原书没有被宣布更新，保存失败可以重试', async () => {
  vi.mocked(parsing.previewEncoding).mockRejectedValueOnce(
    new Error('解码失败'),
  );
  await click('预览正文');
  expect(root.querySelector('[role=alert]')?.textContent).toContain('解码失败');
  expect(stored.applyEncoding).not.toHaveBeenCalled();
  await click('预览正文');
  vi.mocked(stored.applyEncoding).mockRejectedValueOnce(new Error('空间不足'));
  await click('确认切换');
  expect(root.querySelector('[role=alert]')?.textContent).toContain('空间不足');
  expect(applied).not.toHaveBeenCalled();
  await click('确认切换');
  expect(applied).toHaveBeenCalledOnce();
});
it('取消预览中止请求，离开组件后不会应用迟到结果', async () => {
  let resolve!: (value: parsing.ReparsedText) => void;
  vi.mocked(parsing.previewEncoding).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('预览正文');
  const signal = vi.mocked(parsing.previewEncoding).mock.calls[0]![2]!;
  await click('取消');
  expect(signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  await act(() => render(null, root));
  await act(() => {
    resolve(parsed);
  });
  expect(stored.applyEncoding).not.toHaveBeenCalled();
  expect(applied).not.toHaveBeenCalled();
});
