import { beforeEach, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  consumeLaunchFile: vi.fn(),
  readUriChunk: vi.fn(),
  keepAwake: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => bridge,
}));
vi.mock('@capacitor/app', () => ({ App: {} }));

import { launchIncoming, nativeScreenLock } from './native';

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
