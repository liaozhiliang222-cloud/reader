import { expect, it, vi } from 'vitest';
import { installFileConsumer } from './fileLaunch';
import type { LaunchHost } from './fileLaunch';
import type { IncomingData } from './incomingData';
type Consumer = Parameters<
  NonNullable<LaunchHost['launchQueue']>['setConsumer']
>[0];
it('文件启动串行处理，单个读取拒绝不丢其他文件，空启动不创建记录', async () => {
  let consumer!: Consumer;
  const deliver = vi.fn<(data: IncomingData) => Promise<void>>(async () => {}),
    fail = vi.fn();
  const drain = installFileConsumer(
    {
      launchQueue: {
        setConsumer: (value) => {
          consumer = value;
        },
      },
    },
    deliver,
    fail,
  )!;
  consumer({ files: [] });
  await drain();
  expect(deliver).not.toHaveBeenCalled();
  let allow!: (file: File) => void;
  const order: string[] = [];
  consumer({
    files: [
      {
        getFile: () =>
          new Promise<File>((resolve) => {
            allow = resolve;
          }),
      },
      {
        name: '拒绝.txt',
        getFile: async () => {
          throw new Error('denied');
        },
      },
    ],
  });
  consumer({
    files: [
      {
        getFile: async () => {
          order.push('second');
          return new File(['b'], '第二本.txt');
        },
      },
    ],
  });
  await vi.waitFor(() => expect(allow).toBeDefined());
  expect(order).toEqual([]);
  allow(new File(['a'], '第一本.txt'));
  await drain();
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0]?.[0]).toMatchObject({
    errors: ['拒绝.txt：未能读取，请重新选择。'],
  });
  expect(fail).not.toHaveBeenCalled();
  expect(order).toEqual(['second']);
});
it('上一启动暂存失败不会让后续队列停住，不支持接口保持原有手动导入', async () => {
  let consumer!: Consumer;
  const deliver = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error('quota')),
    fail = vi.fn();
  const drain = installFileConsumer(
    {
      launchQueue: {
        setConsumer: (value) => {
          consumer = value;
        },
      },
    },
    deliver,
    fail,
  )!;
  const payload = {
    files: [{ getFile: async () => new File(['a'], '书.txt') }],
  };
  consumer(payload);
  consumer(payload);
  await drain();
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(installFileConsumer({}, deliver, fail)).toBeUndefined();
});
