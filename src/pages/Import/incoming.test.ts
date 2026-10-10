// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IncomingPage } from './IncomingPage';
import { PastePage } from './PastePage';
import { processIncoming } from '@/app/incomingJobs';
import { importDraft } from '@/parsers/importDraft';
import type { IncomingData } from '@/app/incomingData';
import type { Book } from '@/types';

const mocks = vi.hoisted(() => ({
  store: { get: vi.fn(), put: vi.fn(), remove: vi.fn() },
  changed: vi.fn(),
}));
vi.mock('@/app/incoming', () => ({
  incomingStore: () => mocks.store,
  incomingChanged: mocks.changed,
}));
vi.mock('@/app/incomingJobs', () => ({ processIncoming: vi.fn() }));
vi.mock('@/parsers/importDraft', () => ({ importDraft: vi.fn() }));
const root = document.createElement('div');
document.body.append(root);
const id = 'fa8d2d71-7a48-4b44-8bd3-c4d000e6ae84';
const book: Book = {
  id: 'book-id',
  title: '文稿',
  type: 'paste',
  size: 20,
  charCount: 10,
  chapterCount: 1,
  importedAt: 1,
  lastReadAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '#/incoming/' + id);
});
afterEach(() => act(() => render(null, root)));
it('收到单本成功或已有书会直接阅读，只有文字时路由到检查页；卸载释放进度监听', async () => {
  const release = vi.fn();
  vi.mocked(processIncoming).mockReturnValue({
    promise: Promise.resolve({
      items: [{ name: '书.txt', status: 'duplicate', book }],
      data: { files: [], text: '', title: '', errors: [] },
    }),
    release,
  });
  await act(() => render(createElement(IncomingPage, { id }), root));
  await vi.waitFor(() => expect(location.hash).toBe('#/read/book-id'));
  await act(() => render(null, root));
  expect(release).toHaveBeenCalledOnce();
  history.replaceState(null, '', '#/incoming/' + id);
  vi.mocked(processIncoming).mockReturnValue({
    promise: Promise.resolve({
      items: [],
      data: { files: [], text: '分享正文', title: '标题', errors: [] },
    }),
    release,
  });
  await act(() => render(createElement(IncomingPage, { id }), root));
  await vi.waitFor(() => expect(location.hash).toBe('#/paste-share/' + id));
});
it('多文件部分失败保留重试入口，工作中不能返回或放弃；错误ID显示提示且不启动解析', async () => {
  let done!: (
    value: Awaited<ReturnType<typeof processIncoming>['promise']>,
  ) => void;
  vi.mocked(processIncoming).mockReturnValue({
    promise: new Promise((resolve) => {
      done = resolve;
    }),
    release: vi.fn(),
  });
  await act(() => render(createElement(IncomingPage, { id }), root));
  await vi.waitFor(() => expect(done).toBeDefined());
  const back = [...root.querySelectorAll('button')].find(
    (button) => button.textContent === '返回书架',
  )!;
  expect(back.disabled).toBe(true);
  await act(async () =>
    done({
      items: [{ name: '失败.epub', status: 'error', error: '损坏EPUB' }],
      data: {
        files: [new File(['x'], '失败.epub')],
        text: '',
        title: '',
        errors: [],
      },
    }),
  );
  await vi.waitFor(() => expect(root.textContent).toContain('重试未导入文件'));
  expect(location.hash).toBe('#/incoming/' + id);
  await act(() => render(null, root));
  vi.mocked(processIncoming).mockClear();
  await act(() =>
    render(createElement(IncomingPage, { id: 'error-size' }), root),
  );
  expect(root.textContent).toContain('大小限制');
  expect(processIncoming).not.toHaveBeenCalled();
});
it('分享文字在textarea原样预填，保存失败不消费；保存文稿后仍保留混合分享的失败原文件', async () => {
  const text = '# 本地长文\n<script>文字</script>\nhttps://example.test/a';
  const data: IncomingData = {
    files: [new File(['bad'], '损坏.epub')],
    text,
    title: '分享标题',
    errors: [],
  };
  mocks.store.get.mockResolvedValue(data);
  mocks.store.put.mockResolvedValue(undefined);
  vi.mocked(importDraft)
    .mockRejectedValueOnce(new Error('quota'))
    .mockResolvedValueOnce({ book, duplicate: false });
  history.replaceState(null, '', '#/paste-share/' + id);
  await act(() => render(createElement(PastePage, { incomingId: id }), root));
  await vi.waitFor(() =>
    expect(root.querySelector('textarea')?.value).toBe(text),
  );
  expect(root.querySelector('input')?.value).toBe('分享标题');
  expect(root.querySelector('script')).toBeNull();
  await act(() => {
    root
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(root.textContent).toContain('quota'));
  expect(mocks.store.remove).not.toHaveBeenCalled();
  expect(mocks.store.put).not.toHaveBeenCalled();
  await act(() => {
    root
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(location.hash).toBe('#/read/book-id'));
  expect(importDraft).toHaveBeenLastCalledWith(
    text,
    '分享标题',
    undefined,
    'plain',
  );
  expect(mocks.store.put).toHaveBeenCalledWith(id, {
    ...data,
    text: '',
    title: '',
  });
  expect(mocks.store.remove).not.toHaveBeenCalled();
});
