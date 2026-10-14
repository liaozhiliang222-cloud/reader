import { expect, it } from 'vitest';
import { reviewNotes, reviewMarkdown } from './notesReview';
import type { Book, Highlight } from '@/types';
const book = {
  id: 'b',
  title: '原书',
  missingFile: false,
  chapterSummaries: [{ index: 0, title: '第一章' }],
} as Book;
const note: Highlight = {
  id: 'n',
  bookId: 'b',
  chapterIndex: 0,
  start: { paragraphIndex: 0, charOffset: 0 },
  end: { paragraphIndex: 0, charOffset: 8 },
  text: '<script>正文',
  note: '想法',
  color: 'yellow',
  createdAt: 1,
  updatedAt: 1,
  tags: ['思考'],
  reviewPending: true,
};
it('按原书、标签、文字和待回顾组合过滤，缺书摘录保持可取回', () => {
  expect(
    reviewNotes([book], [note], {
      book: 'b',
      tag: '思考',
      query: '想法',
      pending: true,
    }),
  ).toHaveLength(1);
  expect(reviewNotes([book], [note], { tag: '其他' })).toHaveLength(0);
  const archive = {
    ...note,
    archivedSource: { title: '删除前书名', chapterTitle: '保存章节' },
    unanchored: true,
  };
  const row = reviewNotes([], [archive])[0]!;
  expect(row.title).toBe('删除前书名');
  expect(row.available).toBe(false);
  expect(reviewMarkdown([row])).toContain('&lt;script&gt;正文');
  expect(reviewMarkdown([row])).not.toContain('jingye://');
});
it('回跳使用真实本机书与笔记 ID，文本不成为可执行 HTML', () => {
  const text = reviewMarkdown(reviewNotes([book], [note]), 'reading');
  expect(text).toContain('jingye://note/b/n');
  expect(text).toContain('回顾问题');
  expect(text).not.toContain('<script>');
});
