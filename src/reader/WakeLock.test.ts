import { afterEach, expect, it, vi } from 'vitest';
import { ReaderWakeLock, type ScreenLock } from './WakeLock';
class TestLock extends EventTarget implements ScreenLock {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
it('申请期间关闭再开启会释放旧结果并获取新锁，系统释放后不盲目循环', async () => {
  let finish!: (lock: ScreenLock) => void;
  const old = new TestLock(),
    fresh = new TestLock();
  const request = vi
    .fn<() => Promise<ScreenLock>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(fresh);
  const status = vi.fn(),
    controller = new ReaderWakeLock(request, status);
  controller.setMode('always');
  controller.setMode('off');
  controller.setMode('always');
  finish(old);
  await flush();
  await flush();
  expect(old.release).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(2);
  fresh.released = true;
  fresh.dispatchEvent(new Event('release'));
  expect(status).toHaveBeenLastCalledWith('released');
  await flush();
  expect(request).toHaveBeenCalledTimes(2);
  controller.dispose();
});
it('五分钟无操作释放，有操作重新计时，随后可重新获取', async () => {
  vi.useFakeTimers();
  const locks: TestLock[] = [];
  const request = vi.fn(async () => {
    const lock = new TestLock();
    locks.push(lock);
    return lock;
  });
  const controller = new ReaderWakeLock(request, vi.fn());
  controller.setMode('idle5m');
  await flush();
  await vi.advanceTimersByTimeAsync(299000);
  expect(locks[0]?.release).not.toHaveBeenCalled();
  controller.activity();
  await vi.advanceTimersByTimeAsync(299000);
  expect(locks[0]?.release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(locks[0]?.release).toHaveBeenCalledOnce();
  controller.activity();
  await flush();
  expect(request).toHaveBeenCalledTimes(2);
  controller.dispose();
  expect(locks[1]?.release).toHaveBeenCalledOnce();
});
it('始终档不设熄屏计时，切后台释放，返回前台重新获取', async () => {
  vi.useFakeTimers();
  const locks: TestLock[] = [];
  const request = vi.fn(async () => {
    const lock = new TestLock();
    locks.push(lock);
    return lock;
  });
  const controller = new ReaderWakeLock(request, vi.fn());
  controller.setMode('always');
  await flush();
  await vi.advanceTimersByTimeAsync(600000);
  expect(locks[0]?.release).not.toHaveBeenCalled();
  controller.setVisible(false);
  expect(locks[0]?.release).toHaveBeenCalledOnce();
  controller.setVisible(true);
  await flush();
  expect(locks).toHaveLength(2);
  controller.dispose();
});
it('关闭后的迟到申请结果被释放，拒绝只显示状态而不无限重试', async () => {
  let finish!: (lock: ScreenLock) => void;
  const controller = new ReaderWakeLock(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    vi.fn(),
  );
  controller.setMode('always');
  controller.dispose();
  const lock = new TestLock();
  finish(lock);
  await flush();
  expect(lock.release).toHaveBeenCalledOnce();
  const status = vi.fn(),
    request = vi.fn().mockRejectedValue(new Error('Denied'));
  const denied = new ReaderWakeLock(request, status);
  denied.setMode('always');
  await flush();
  expect(status).toHaveBeenCalledWith('unavailable');
  expect(request).toHaveBeenCalledOnce();
  denied.dispose();
});
