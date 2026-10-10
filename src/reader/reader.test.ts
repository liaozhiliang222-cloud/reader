import { describe, expect, it } from 'vitest';
import { gestureAction } from './gestures';
import { pageGeometry, pageCount } from './paginator';

describe('分页几何与手势', () => {
  it.each([14, 18, 24, 28])('字号 %i 的页面高度按整行对齐', (size) => {
    const g = pageGeometry(390, 844, size, 24);
    expect(g.width + g.gap).toBe(g.stride);
    expect(g.height / g.line).toBeCloseTo(Math.round(g.height / g.line), 8);
    expect(g.height).toBeLessThanOrEqual(844 - 112);
  });
  it('页数不受末页边距与亚像素舍入影响', () => {
    expect(pageCount(342, 390)).toBe(1);
    expect(pageCount(732, 390)).toBe(2);
    expect(pageCount(780.1, 390)).toBe(2);
  });
  it('短点击分区、滑动方向及长按/竖向滚动互不冲突', () => {
    expect(gestureAction(0, 0, 100, 0.1)).toBe('previous');
    expect(gestureAction(0, 0, 100, 0.5)).toBe('menu');
    expect(gestureAction(0, 0, 100, 0.9)).toBe('next');
    expect(gestureAction(-100, 10, 300, 0.5)).toBe('next');
    expect(gestureAction(15, 0, 30, 0.5)).toBe('previous');
    expect(gestureAction(0, 0, 700, 0.9)).toBeNull();
    expect(gestureAction(-100, 0, 700, 0.9)).toBe('next');
    expect(gestureAction(120, 5, 1200, 0.1)).toBe('previous');
    expect(gestureAction(-30, 0, 700, 0.9)).toBeNull();
    expect(gestureAction(20, 100, 200, 0.9)).toBeNull();
  });
  it('单手模式两侧向前、仅左上角返回，中间菜单与滑动方向及长按保留', () => {
    expect(gestureAction(0, 0, 100, 0.1, 'oneHand')).toBe('next');
    expect(gestureAction(0, 0, 100, 0.9, 'oneHand')).toBe('next');
    expect(gestureAction(0, 0, 100, 0.1, 'oneHand', true)).toBe('previous');
    expect(gestureAction(0, 0, 100, 0.5, 'oneHand')).toBe('menu');
    expect(gestureAction(80, 0, 100, 0.9, 'oneHand')).toBe('previous');
    expect(gestureAction(-80, 0, 100, 0.1, 'oneHand', true)).toBe('next');
    expect(gestureAction(0, 0, 700, 0.1, 'oneHand', true)).toBeNull();
    expect(gestureAction(0, 80, 100, 0.1, 'oneHand', true)).toBeNull();
  });
});
