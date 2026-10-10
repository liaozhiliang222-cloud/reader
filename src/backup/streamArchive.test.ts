import JSZip from 'jszip';
import { expect, it, vi } from 'vitest';
import { streamArchive } from './streamArchive';

it('懒供给在字段预检前不调用，返回字节大小矛盾时停止且不读取下一条', async () => {
  const read = vi.fn(async () => new ArrayBuffer(2)),
    later = vi.fn(async () => new ArrayBuffer(0));
  for (const size of [-1, NaN, 0xffffffff])
    await expect(
      streamArchive([{ path: 'first', size, read }], () => {}),
    ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  await expect(
    streamArchive(
      [
        { path: 'first', size: 3, read },
        { path: 'later', size: 0, read: later },
      ],
      () => {},
    ),
  ).rejects.toThrow('大小');
  expect(read).toHaveBeenCalledOnce();
  expect(later).not.toHaveBeenCalled();
});

it('在读取任何原文前拒绝重复路径及32位容量溢出，不生成不可恢复的ZIP', async () => {
  const source = new Blob(['original']);
  const read = vi.spyOn(source, 'arrayBuffer');
  await expect(
    streamArchive(
      [
        { path: 'same', data: source },
        { path: 'same', data: source },
      ],
      () => {},
    ),
  ).rejects.toThrow('重复');
  await expect(
    streamArchive(
      Array.from({ length: 20_001 }, (_, index) => ({
        path: `book-${index}`,
        data: source,
      })),
      () => {},
    ),
  ).rejects.toThrow('条目');
  const longName = 'x'.repeat(60_000);
  await expect(
    streamArchive(
      Array.from({ length: 600 }, (_, index) => ({
        path: `${longName}${index}`,
        data: source,
      })),
      () => {},
    ),
  ).rejects.toThrow('目录');
  Object.defineProperty(source, 'size', { value: 0xffffffff });
  await expect(
    streamArchive([{ path: 'large', data: source }], () => {}),
  ).rejects.toThrow('上限');
  expect(read).not.toHaveBeenCalled();
});

it('原文件按顺序读取且不并发展开，输出可由独立JSZip CRC读取，空文件/中文路径保留', async () => {
  const entries = [
    { path: 'backup.json', data: new Blob(['{"app":"jingye"}']) },
    { path: 'books/原创.txt', data: new Blob(['原创正文😀'.repeat(150000)]) },
    { path: 'books/empty.txt', data: new Blob([]) },
    { path: 'books/second.txt', data: new Blob(['最后一本']) },
  ];
  let reading = 0,
    peak = 0;
  const order: string[] = [],
    progress: number[] = [];
  for (const entry of entries) {
    const read = entry.data.arrayBuffer.bind(entry.data);
    vi.spyOn(entry.data, 'arrayBuffer').mockImplementation(async () => {
      order.push(entry.path);
      reading++;
      peak = Math.max(peak, reading);
      await new Promise((resolve) => setTimeout(resolve, 2));
      try {
        return await read();
      } finally {
        reading--;
      }
    });
  }
  const blob = await streamArchive(entries, (value) => progress.push(value));
  expect(peak).toBe(1);
  expect(order).toEqual(entries.map((entry) => entry.path));
  expect(progress.at(-1)).toBe(100);
  const parsed = await JSZip.loadAsync(await blob.arrayBuffer(), {
    checkCRC32: true,
  });
  expect(Object.keys(parsed.files)).toEqual(entries.map((entry) => entry.path));
  for (const entry of entries)
    expect(await parsed.file(entry.path)!.async('string')).toBe(
      await entry.data.text(),
    );
});

it('原文读取失败不读取后续文件、不交付半个ZIP，进度回调错误也拒绝', async () => {
  const broken = new Blob(['broken']),
    later = new Blob(['later']);
  vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(
    new Error('disk unavailable'),
  );
  const readLater = vi.spyOn(later, 'arrayBuffer');
  await expect(
    streamArchive(
      [
        { path: 'first', data: new Blob(['first']) },
        { path: 'broken', data: broken },
        { path: 'later', data: later },
      ],
      () => {},
    ),
  ).rejects.toThrow('disk unavailable');
  expect(readLater).not.toHaveBeenCalled();
  await expect(
    streamArchive([{ path: 'one', data: later }], () => {
      throw new Error('stop');
    }),
  ).rejects.toThrow('stop');
});
