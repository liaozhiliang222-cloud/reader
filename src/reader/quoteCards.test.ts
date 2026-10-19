import { expect, it } from 'vitest';
import { wrapQuote } from './quoteCards';
const width = (text: string) => [...text].length;
it('英文摘录优先按词换行，保持完整原文', () => {
  const text = 'A quiet page makes room for thought.';
  const lines = wrapQuote(text, width, 14);
  expect(lines.join('')).toBe(text);
  expect(lines.every((line) => width(line) <= 14)).toBe(true);
  for (let i = 1; i < lines.length; i++)
    expect(/\s$/.test(lines[i - 1]!) || /^\s/.test(lines[i]!)).toBe(true);
});
it('超长单词、中英文与 emoji 安全换行，保留显式空行', () => {
  const lines = wrapQuote('longwordwithoutbreak😀中文', width, 5);
  expect(lines.join('')).toBe('longwordwithoutbreak😀中文');
  expect(lines.every((line) => width(line) <= 5)).toBe(true);
  expect(wrapQuote('one\n\n第二行', width, 5)).toEqual(['one', '', '第二行']);
});
