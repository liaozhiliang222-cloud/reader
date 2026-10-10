import { afterEach, expect, it, vi } from 'vitest';
import { beginMeasure } from './performance';
afterEach(() => vi.restoreAllMocks());
it('debug计时并发可用、只结束一次，报告或取消后不积累Performance条目', () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const initial = performance.getEntries().length;
  const first = beginMeasure('正文', true),
    cancelled = beginMeasure('目录', true);
  first();
  first();
  cancelled(false);
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]![0]).toMatch(/^性能 · 正文 · \d+\.\d ms$/);
  expect(performance.getEntries().length).toBe(initial);
});
it('普通入口不创建标记或输出日志', () => {
  const mark = vi.spyOn(performance, 'mark'),
    log = vi.spyOn(console, 'info');
  beginMeasure('正文', false)();
  expect(mark).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});
