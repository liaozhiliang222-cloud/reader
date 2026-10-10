import { expect, it } from 'vitest';
import {
  groupHighlights,
  highlightSegments,
  normalizeSpan,
  spanText,
} from './annotation';
import { notesFilename, notesMarkdown } from './exportNotes';
import { selectionMenuPosition } from './selection';
import type { Highlight } from '@/types';
const item = (id: string, chapterIndex = 0, time = 1): Highlight => ({
  id,
  bookId: 'b',
  chapterIndex,
  start: { paragraphIndex: 0, charOffset: 0 },
  end: { paragraphIndex: 0, charOffset: 3 },
  text: '原文',
  color: 'red',
  createdAt: time,
  updatedAt: time,
});
it('跨段正反范围等价，不拆 Unicode 代理对，拒绝越界与空选区', () => {
  const paragraphs = ['甲😀乙', '', '丙丁戊'];
  const raw = {
    chapterIndex: 0,
    start: { paragraphIndex: 0, charOffset: 2 },
    end: { paragraphIndex: 2, charOffset: 2 },
  };
  const span = normalizeSpan(paragraphs, raw)!;
  expect(span.start.charOffset).toBe(1);
  expect(spanText(paragraphs, span)).toBe('😀乙\n\n丙丁');
  expect(
    normalizeSpan(paragraphs, { ...raw, start: raw.end, end: raw.start }),
  ).toEqual(span);
  expect(
    normalizeSpan(paragraphs, {
      ...raw,
      start: { paragraphIndex: 0, charOffset: 1 },
      end: { paragraphIndex: 0, charOffset: 2 },
    })?.end.charOffset,
  ).toBe(3);
  expect(
    normalizeSpan(paragraphs, {
      ...raw,
      end: { paragraphIndex: 8, charOffset: 0 },
    }),
  ).toBeUndefined();
  expect(
    normalizeSpan(paragraphs, {
      ...raw,
      start: { paragraphIndex: 0, charOffset: -1 },
    }),
  ).toBeUndefined();
  expect(
    normalizeSpan(paragraphs, { ...raw, start: raw.end, end: raw.end }),
  ).toBeUndefined();
  expect(
    normalizeSpan(['   '], {
      ...raw,
      start: { paragraphIndex: 0, charOffset: 0 },
      end: { paragraphIndex: 0, charOffset: 3 },
    }),
  ).toBeUndefined();
});
it('重叠片段包含所有标注，较新标注颜色优先，不丢原范围', () => {
  const old = item('old'),
    recent = { ...item('recent', 0, 2), color: 'blue' as const };
  const parts = highlightSegments(8, [
    { start: 1, end: 5, item: old },
    { start: 3, end: 7, item: recent },
  ]);
  expect(parts.map((p) => [p.start, p.end, p.items.map((i) => i.id)])).toEqual([
    [0, 1, []],
    [1, 3, ['old']],
    [3, 5, ['old', 'recent']],
    [5, 7, ['recent']],
    [7, 8, []],
  ]);
  expect(
    groupHighlights([item('last', 2), old, recent]).map((g) => g.chapterIndex),
  ).toEqual([0, 2]);
});
it('菜单放在选区上方，顶部不足时放下方，屏幕边缘保持可见', () => {
  const viewport = { left: 0, top: 0, right: 390, bottom: 844 };
  expect(
    selectionMenuPosition(
      { left: 100, right: 150, top: 200, bottom: 230 },
      280,
      100,
      viewport,
    ),
  ).toEqual({ left: 8, top: 92 });
  expect(
    selectionMenuPosition(
      { left: 300, right: 390, top: 10, bottom: 40 },
      280,
      100,
      viewport,
    ),
  ).toEqual({ left: 102, top: 48 });
  expect(
    selectionMenuPosition(
      { left: 0, right: 390, top: 0, bottom: 844 },
      280,
      100,
      viewport,
    ).top,
  ).toBe(736);
});
it('Markdown 按章节与位置排序，保留多段引用、笔记与时间，引用不生成 HTML', () => {
  const later = {
    ...item('later', 1),
    text: '甲\n\n<script>\n# 乙',
    note: '我的笔记\n第二行 *星*',
  };
  const first = { ...item('first'), text: '😀 引文', createdAt: 0 };
  const markdown = notesMarkdown(
    { title: '[书名]\n续行', author: '作者' },
    [{ index: 1, title: '第二章', charStart: 5, charCount: 10 }],
    [later, first],
  );
  expect(markdown.startsWith('# \\[书名\\] 续行\n\n作者：作者')).toBe(true);
  expect(markdown.indexOf('## 第 1 节')).toBeLessThan(
    markdown.indexOf('## 第二章'),
  );
  expect(markdown).toContain('> 甲\n> \n> &lt;script\\>\n> \\# 乙');
  expect(markdown).toContain('**笔记**\n\n我的笔记\n第二行 \\*星\\*');
  expect(markdown).toContain('1970-01-01T00:00:00.000Z');
  expect(notesFilename('书/名:甲?')).toBe('书_名_甲__笔记.md');
});
