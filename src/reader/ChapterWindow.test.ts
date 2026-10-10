import { expect, it, vi } from 'vitest';
import { ChapterWindow } from './ChapterWindow';

it('连续切过五章只保留相邻三个实例，离开窗口和关闭时释放一次', async () => {
  const created = new Map<number, { release: ReturnType<typeof vi.fn> }>();
  const cache = new ChapterWindow(async (index) => {
    const instance = { release: vi.fn() };
    created.set(index, instance);
    return instance;
  });
  for (let index = 0; index < 5; index++) {
    const indices = [index - 1, index, index + 1].filter(
      (i) => i >= 0 && i < 5,
    );
    cache.retain(indices);
    await Promise.all(indices.map((i) => cache.get(i)));
    expect(cache.values()).toHaveLength(indices.length);
  }
  expect(created.get(0)?.release).toHaveBeenCalledOnce();
  expect(created.get(4)?.release).not.toHaveBeenCalled();
  cache.dispose();
  for (const chapter of created.values())
    expect(chapter.release).toHaveBeenCalledOnce();
});
it('同章并发复用一个构建，淘汰后晚到的结果不能重回窗口', async () => {
  let finish!: (value: { release: () => void }) => void;
  let signal!: AbortSignal;
  const create = vi.fn((_index: number, abort: AbortSignal) => {
    signal = abort;
    return new Promise<{ release: () => void }>((resolve) => {
      finish = resolve;
    });
  });
  const cache = new ChapterWindow(create);
  const first = cache.get(0),
    second = cache.get(0);
  expect(first).toBe(second);
  const rejected = expect(first).rejects.toThrow('取消');
  await Promise.resolve();
  cache.retain([1]);
  expect(signal.aborted).toBe(true);
  const release = vi.fn();
  finish({ release });
  await rejected;
  expect(create).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  expect(cache.ready(0)).toBeUndefined();
});
it('旧任务失败不删除同编号的新构建；销毁时晚到实例也会释放', async () => {
  const resolvers: Array<(value: { release: () => void }) => void> = [];
  const cache = new ChapterWindow(
    () =>
      new Promise<{ release: () => void }>((resolve) =>
        resolvers.push(resolve),
      ),
  );
  const old = cache.get(1);
  const rejected = expect(old).rejects.toThrow();
  await Promise.resolve();
  cache.retain([]);
  const newer = cache.get(1);
  await Promise.resolve();
  const newRelease = vi.fn();
  resolvers[1]!({ release: newRelease });
  await newer;
  const oldRelease = vi.fn();
  resolvers[0]!({ release: oldRelease });
  await rejected;
  expect(cache.ready(1)?.release).toBe(newRelease);
  expect(oldRelease).toHaveBeenCalledOnce();
  const pending = cache.get(2);
  const cancelled = expect(pending).rejects.toThrow();
  await Promise.resolve();
  cache.dispose();
  const pendingRelease = vi.fn();
  resolvers[2]!({ release: pendingRelease });
  await cancelled;
  expect(newRelease).toHaveBeenCalledOnce();
  expect(pendingRelease).toHaveBeenCalledOnce();
  await expect(cache.get(0)).rejects.toThrow('关闭');
});
it('预排版失败后下次请求可重试', async () => {
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error('损坏'))
    .mockResolvedValue({ release: vi.fn() });
  const cache = new ChapterWindow<{ release: () => void }>(create);
  await expect(cache.get(0)).rejects.toThrow('损坏');
  await cache.get(0);
  expect(cache.ready(0)).toBeDefined();
  expect(create).toHaveBeenCalledTimes(2);
  cache.dispose();
});
