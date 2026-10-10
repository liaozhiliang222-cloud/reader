// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { onIdle } from './idle';
const request = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
const cancel = Object.getOwnPropertyDescriptor(window, 'cancelIdleCallback');
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (request) Object.defineProperty(window, 'requestIdleCallback', request);
  else Reflect.deleteProperty(window, 'requestIdleCallback');
  if (cancel) Object.defineProperty(window, 'cancelIdleCallback', cancel);
  else Reflect.deleteProperty(window, 'cancelIdleCallback');
});
it('原生idle任务可取消并设置有限等待', () => {
  const requestIdle = vi.fn().mockReturnValue(7),
    cancelIdle = vi.fn(),
    work = vi.fn();
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    value: requestIdle,
  });
  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    value: cancelIdle,
  });
  const stop = onIdle(work);
  expect(requestIdle).toHaveBeenCalledWith(work, { timeout: 2000 });
  stop();
  expect(cancelIdle).toHaveBeenCalledWith(7);
});
it('不支持idle时分次让出事件循环，取消不会排版', () => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    value: undefined,
  });
  const cancelled = vi.fn(),
    work = vi.fn();
  onIdle(cancelled)();
  onIdle(work);
  vi.advanceTimersByTime(119);
  expect(work).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(work).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
});
