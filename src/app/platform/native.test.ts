import { beforeEach, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  consumeLaunchFile: vi.fn(),
  readUriChunk: vi.fn(),
  keepAwake: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => bridge,
}));
vi.mock('@capacitor/app', () => ({ App: {} }));

import { launchIncoming, listenIncoming, nativeScreenLock } from './native';

beforeEach(() => vi.resetAllMocks());

it('原生常亮申请失败可交给阅读器显示不可用，避免未处理的拒绝', async () => {
  bridge.keepAwake.mockRejectedValue(new Error('window unavailable'));
  await expect(nativeScreenLock()).rejects.toThrow('window unavailable');
});

it.each([31, 512 * 1024 + 37, 2 * 512 * 1024])(
  '原生导入 %i 字节逐块还原，保留全部原始字节',
  async (size) => {
    const source = Buffer.alloc(size);
    for (let i = 0; i < size; i++) source[i] = i % 251;
    bridge.consumeLaunchFile.mockResolvedValue({
      items: [{ uri: 'content://fixture/book', name: '原文.epub' }],
    });
    bridge.readUriChunk.mockImplementation(
      async ({ offset, length }: { offset: number; length: number }) => ({
        data: source.subarray(offset, offset + length).toString('base64'),
        eof: offset + length > size,
      }),
    );
    const incoming = await launchIncoming();
    expect(incoming?.errors).toEqual([]);
    expect(incoming?.files).toHaveLength(1);
    expect(Buffer.from(await incoming!.files[0]!.arrayBuffer())).toEqual(
      source,
    );
  },
);

it('原生批量导入中一个 URI 失败不影响其余文件和分享文字', async () => {
  bridge.consumeLaunchFile.mockResolvedValue({
    items: [
      { uri: 'content://fixture/denied', name: '失败.txt' },
      { uri: 'content://fixture/valid', name: '有效.md' },
    ],
    text: ' 分享的文字 ',
  });
  bridge.readUriChunk.mockImplementation(async ({ uri }: { uri: string }) => {
    if (uri.endsWith('denied')) throw new Error('permission denied');
    return { data: Buffer.from('# 正文').toString('base64'), eof: true };
  });
  const incoming = await launchIncoming();
  expect(incoming?.files.map((file) => file.name)).toEqual(['有效.md']);
  expect(incoming?.errors).toHaveLength(1);
  expect(incoming?.errors[0]).toContain('失败.txt');
  expect(incoming?.text).toBe('分享的文字');
});

it('没有 EOF 且没有字节的桥响应停止读取，避免无限循环', async () => {
  bridge.consumeLaunchFile.mockResolvedValue({
    items: [{ uri: 'content://fixture/stalled', name: '停滞.txt' }],
  });
  bridge.readUriChunk.mockResolvedValue({ data: '', eof: false });
  const incoming = await launchIncoming();
  expect(incoming?.files).toHaveLength(0);
  expect(incoming?.errors).toHaveLength(1);
  expect(bridge.readUriChunk).toHaveBeenCalledTimes(1);
});

it('普通启动的空 Intent 不报告导入错误，读取或桥调用失败都结束加载反馈', async () => {
  const progress = vi.fn();
  bridge.consumeLaunchFile.mockResolvedValue({});
  expect(await launchIncoming(progress)).toBeUndefined();
  expect(progress.mock.calls).toEqual([[undefined]]);
  bridge.consumeLaunchFile.mockRejectedValue(new Error('bridge'));
  await expect(launchIncoming(progress)).rejects.toThrow('bridge');
  expect(progress).toHaveBeenLastCalledWith(undefined);
});

it('热分享串行读取，当前份交付完成才处理下一份，失败也能继续并清理监听', async () => {
  let receive!: (payload: { items: { uri: string; name: string }[] }) => void;
  const remove = vi.fn().mockResolvedValue(undefined);
  bridge.addListener.mockImplementation(
    async (_event: string, listener: typeof receive) => {
      receive = listener;
      return { remove };
    },
  );
  let finish!: () => void;
  bridge.readUriChunk
    .mockImplementationOnce(
      () =>
        new Promise<{ data: string; eof: boolean }>((resolve) => {
          finish = () => resolve({ data: btoa('body'), eof: true });
        }),
    )
    .mockRejectedValueOnce(new Error('denied'));
  const delivered = vi.fn().mockResolvedValue(undefined),
    fail = vi.fn(),
    progress = vi.fn();
  const dispose = listenIncoming(delivered, fail, progress);
  receive({ items: [{ uri: 'content://one', name: 'one.txt' }] });
  receive({ items: [{ uri: 'content://two', name: 'two.txt' }] });
  await vi.waitFor(() => expect(bridge.readUriChunk).toHaveBeenCalledTimes(1));
  expect(delivered).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(delivered).toHaveBeenCalledTimes(2));
  expect(delivered.mock.calls[0]![0].files[0].name).toBe('one.txt');
  expect(delivered.mock.calls[1]![0].errors[0]).toContain('two.txt');
  expect(progress).toHaveBeenLastCalledWith(undefined);
  expect(fail).not.toHaveBeenCalled();
  dispose();
  await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
});
