import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorkerTask } from './runTask';

afterEach(() => vi.useRealTimers());
describe('Worker 失败处理', () => {
  it('取消悬空任务清除定时器和监听，已取消任务不启动 RPC', async () => {
    vi.useFakeTimers();
    const worker = new EventTarget() as Worker;
    const abort = new AbortController();
    const task = vi.fn(() => new Promise<number>(() => {}));
    const pending = runWorkerTask(worker, task, 100, abort.signal);
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    abort.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(task).not.toHaveBeenCalled();
    await expect(
      runWorkerTask(worker, task, 100, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(task).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('启动错误结束悬空任务', async () => {
    const worker = new EventTarget() as Worker;
    const task = runWorkerTask(worker, () => new Promise(() => {}));
    worker.dispatchEvent(new Event('error'));
    await expect(task).rejects.toThrow('解析线程');
  });
  it('超时退出而不是让导入界面无限等待', async () => {
    vi.useFakeTimers();
    const task = runWorkerTask(
      new EventTarget() as Worker,
      () => new Promise(() => {}),
      100,
    );
    const assertion = expect(task).rejects.toThrow('解析超时');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('成功后移除监听和定时器', async () => {
    vi.useFakeTimers();
    const worker = new EventTarget() as Worker;
    const remove = vi.spyOn(worker, 'removeEventListener');
    await expect(runWorkerTask(worker, async () => 42)).resolves.toBe(42);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
