import { expect, it } from 'vitest';
import { visibleRange } from './virtual';
it('千章目录只生成视口与缓冲区的行，末尾和空列表不越界', () => {
  expect(visibleRange(1000, 500 * 56, 560)).toEqual({ start: 496, end: 514 });
  expect(visibleRange(1000, 999 * 56, 560)).toEqual({ start: 995, end: 1000 });
  expect(visibleRange(1000, -1, 560)).toEqual({ start: 0, end: 14 });
  expect(visibleRange(0, 0, 560)).toEqual({ start: 0, end: 0 });
});
