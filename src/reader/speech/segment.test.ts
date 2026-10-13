import { describe, expect, it } from 'vitest';
import { segmentText } from './segment';

const spans = (text: string) =>
  segmentText(text).map((s) => text.slice(s.start, s.end));

describe('分句', () => {
  it('中文终止符断句并吃掉收尾引号', () => {
    expect(spans('他说。「好的。」走吧！')).toEqual([
      '他说。',
      '「好的。」',
      '走吧！',
    ]);
  });

  it('英文缩写、小数、首字母缩写不拆句', () => {
    expect(spans('Dr. Smith said 3.14 is fine. Really? Yes.')).toEqual([
      'Dr. Smith said 3.14 is fine.',
      'Really?',
      'Yes.',
    ]);
    expect(spans('J. R. R. Tolkien wrote books.')).toEqual([
      'J. R. R. Tolkien wrote books.',
    ]);
  });

  it('emoji 与代理对不被切开', () => {
    const out = spans('笑😀！好👍👍。');
    expect(out).toEqual(['笑😀！', '好👍👍。']);
    const long = '很长'.repeat(150) + '😀结尾';
    for (const s of segmentText(long)) {
      const start = long.codePointAt(s.start)!;
      const last = long.codePointAt(s.end - 1)!;
      expect(start >= 0xd800 && start <= 0xdfff).toBe(false);
      expect(last >= 0xdc00 && last <= 0xdfff).toBe(false);
    }
  });

  it('超长句按从属标点再切，仍超长按长度硬切', () => {
    const commas = '内容'.repeat(30) + '，' + '更多'.repeat(80) + '。';
    const out = spans(commas);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join('')).toBe(commas);
    const hard = '字'.repeat(500) + '。';
    const split = spans(hard);
    expect(split.length).toBeGreaterThan(1);
    expect(split.join('')).toBe(hard);
    expect(split.every((s) => s.length <= 200)).toBe(true);
  });

  it('重复句各自成句，空白与纯标点不成句', () => {
    expect(spans('好。好。')).toEqual(['好。', '好。']);
    expect(spans('  \n 。 ！ ')).toEqual([]);
    expect(spans('')).toEqual([]);
    expect(spans('   ')).toEqual([]);
  });

  it('区间是原文字符偏移（UTF-16）', () => {
    const text = '  甲。乙。';
    const result = segmentText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ start: 2, end: 4 });
    expect(result[1]).toEqual({ start: 4, end: 6 });
  });
});
