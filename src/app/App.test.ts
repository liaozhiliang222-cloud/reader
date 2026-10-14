// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { initialSettings } from '@/app/settings';
import type { NativeImportProgress } from './platform/native';
import type { IncomingData } from './incomingData';

const mocks = vi.hoisted(() => ({
  startup: vi.fn(),
  launch: vi.fn(),
  listen: vi.fn(),
  put: vi.fn(),
  incoming: vi.fn(),
  shelf: vi.fn(),
}));
vi.mock('./startup', () => ({ loadStartup: mocks.startup }));
vi.mock('./platform', () => ({
  isNativeApp: true,
  isAndroidApp: true,
  isIosApp: false,
  hasNativeSpeech: true,
  nativeApp: async () => ({
    cleanupServiceWorkers: vi.fn(),
    installBackButton: vi.fn(),
    listenSpeechOpen: () => () => {},
    launchIncoming: mocks.launch,
    listenIncoming: mocks.listen,
  }),
}));
vi.mock('./pwa', () => ({ startPwa: vi.fn() }));
vi.mock('./theme', () => ({ watchAppearance: vi.fn() }));
vi.mock('./optionalFont', () => ({ restoreOptionalFont: vi.fn() }));
vi.mock('./incoming', () => ({
  incomingStore: () => ({ put: mocks.put }),
  incomingChanged: vi.fn(),
}));
vi.mock('@/pages/Import/IncomingPage', () => ({
  IncomingPage: mocks.incoming,
}));
vi.mock('@/pages/Bookshelf/BookshelfPage', () => ({
  BookshelfPage: mocks.shelf,
}));
vi.mock('@/components/Modal', () => ({
  Modal: ({ children }: { children: import('preact').ComponentChildren }) =>
    createElement('div', { role: 'dialog' }, children),
}));

const root = document.createElement('div');
document.body.append(root);
beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState(null, '', '#/incoming/error-size');
  mocks.startup.mockResolvedValue({
    settings: { ...initialSettings(), onboarded: true },
    hash: location.hash,
    notice: '',
  });
  mocks.listen.mockReturnValue(vi.fn());
  mocks.put.mockResolvedValue(undefined);
  mocks.incoming.mockImplementation(() =>
    createElement('p', null, '旧导入失败页面'),
  );
  mocks.shelf.mockImplementation(({ notice }: { notice: string }) =>
    createElement('p', null, '书架' + notice),
  );
});
afterEach(() => act(() => render(null, root)));

it('慢速原生启动检查期间不挂载旧导入错误页，显示真实分块读取量', async () => {
  let finish!: (data: IncomingData | undefined) => void;
  mocks.launch.mockImplementation(
    (progress?: (value: NativeImportProgress | undefined) => void) => {
      progress?.({
        fileName: '小说.epub',
        index: 1,
        total: 1,
        bytes: 2 * 1024 * 1024,
      });
      return new Promise<IncomingData | undefined>((resolve) => {
        finish = (data) => {
          progress?.(undefined);
          resolve(data);
        };
      });
    },
  );
  await act(() => render(createElement(App, {}), root));
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledOnce());
  expect(mocks.incoming).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(root.textContent).toContain('已读取 2.0 MB'));
  expect(root.querySelector('[role="alert"]')).toBeNull();
  await act(async () =>
    finish({ files: [], text: '新分享', title: '', errors: [] }),
  );
  await vi.waitFor(() =>
    expect(location.hash).toMatch(/^#\/incoming\/[0-9a-f-]{36}$/),
  );
  expect(mocks.put).toHaveBeenCalledOnce();
  expect(root.textContent).not.toContain('正在读取书籍');
});

it('普通打开在原生检查完成后显示书架，不残留导入动效', async () => {
  mocks.startup.mockResolvedValue({
    settings: { ...initialSettings(), onboarded: true },
    hash: '#/',
    notice: '',
  });
  mocks.launch.mockResolvedValue(undefined);
  await act(() => render(createElement(App, {}), root));
  await vi.waitFor(() => expect(root.textContent).toBe('书架'));
  expect(mocks.incoming).not.toHaveBeenCalled();
  expect(mocks.startup).toHaveBeenCalledWith('#/incoming/error-size', true);
});

it('启动桥或暂存失败退出加载并显示可操作的错误，未处理的分享仍保留', async () => {
  mocks.startup.mockResolvedValue({
    settings: { ...initialSettings(), onboarded: true },
    hash: '#/',
    notice: '',
  });
  mocks.launch.mockRejectedValue(new Error('bridge'));
  await act(() => render(createElement(App, {}), root));
  await vi.waitFor(() =>
    expect(root.textContent).toContain('未能接收系统打开的文件'),
  );
  expect(root.textContent).not.toContain('正在打开静页');
});

it('热分享读取期间保留当前页面，完成后移除加载层', async () => {
  mocks.startup.mockResolvedValue({
    settings: { ...initialSettings(), onboarded: true },
    hash: '#/',
    notice: '',
  });
  mocks.launch.mockResolvedValue(undefined);
  await act(() => render(createElement(App, {}), root));
  await vi.waitFor(() => expect(root.textContent).toBe('书架'));
  const progress = mocks.listen.mock.calls[0]![2] as (
    value: NativeImportProgress | undefined,
  ) => void;
  await act(() =>
    progress({ fileName: '新文章.md', index: 1, total: 1, bytes: 512 * 1024 }),
  );
  expect(root.textContent).toContain('书架');
  expect(root.querySelector('[role="dialog"]')?.textContent).toContain(
    '新文章.md',
  );
  await act(() => progress(undefined));
  expect(root.querySelector('[role="dialog"]')).toBeNull();
});
