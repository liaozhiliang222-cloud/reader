import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorkerTask } from './runTask';
import { setWorkerLanguage } from '@/i18n';

function workerDouble() {
  return Object.assign(new EventTarget(), {
    postMessage: vi.fn(),
  }) as unknown as Worker;
}

afterEach(() => vi.useRealTimers());
describe('Worker 失败处理', () => {
  it('取消悬空任务清除定时器和监听，已取消任务不启动 RPC', async () => {
    vi.useFakeTimers();
    const worker = workerDouble();
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
    const worker = workerDouble();
    const task = runWorkerTask(worker, () => new Promise(() => {}));
    worker.dispatchEvent(new Event('error'));
    await expect(task).rejects.toThrow('解析线程');
  });
  it('超时退出而不是让导入界面无限等待', async () => {
    vi.useFakeTimers();
    const task = runWorkerTask(
      workerDouble(),
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
    const worker = workerDouble();
    const remove = vi.spyOn(worker, 'removeEventListener');
    await expect(runWorkerTask(worker, async () => 42)).resolves.toBe(42);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('在 RPC 之前发送界面语言，解析错误使用相同语言', async () => {
    setWorkerLanguage('en');
    const worker = workerDouble();
    await runWorkerTask(worker, async () => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'weiguang:language',
        language: 'en',
      });
    });
    setWorkerLanguage('zh-Hans');
  });
});
