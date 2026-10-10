import { describe, expect, it } from 'vitest';
import { appendBounded, formatDebugValue } from './debug';

describe('开发日志', () => {
  it('支持错误、空值与循环对象，不干扰原始日志', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(formatDebugValue(circular)).toBe('[无法序列化的对象]');
    expect(formatDebugValue(new Error('导入失败'))).toBe('Error: 导入失败');
    expect(formatDebugValue(undefined)).toBe('undefined');
    expect(formatDebugValue({ ready: true })).toBe('{"ready":true}');
  });
  it('限制日志数量以避免长时间调试占用无限内存', () => {
    expect(appendBounded([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
    expect(appendBounded([1, 2], 3, 1)).toEqual([3]);
    expect(appendBounded([], 3, 100)).toEqual([3]);
    expect(appendBounded([1], 2, 0)).toEqual([]);
  });
});
