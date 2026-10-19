import type { Book, Highlight } from '@/types';
export interface ReviewNote {
  item: Highlight;
  title: string;
  chapterTitle: string;
  available: boolean;
}
export function reviewNotes(
  books: Book[],
  notes: Highlight[],
  filters: {
    book?: string;
    tag?: string;
    query?: string;
    pending?: boolean;
    order?: 'recent' | 'oldest';
  } = {},
): ReviewNote[] {
  const map = new Map(books.map((book) => [book.id, book]));
  return notes
    .filter(
      (item) =>
        (!filters.book || item.bookId === filters.book) &&
        (!filters.tag || item.tags?.includes(filters.tag)) &&
        (!filters.pending || item.reviewPending) &&
        (!filters.query ||
          `${item.text}\n${item.note ?? ''}`
            .toLocaleLowerCase()
            .includes(filters.query.toLocaleLowerCase())),
    )
    .map((item) => {
      const book = map.get(item.bookId);
      return {
        item,
        title: item.archivedSource?.title ?? book?.title ?? '原书已删除',
        chapterTitle:
          item.archivedSource?.chapterTitle ??
          book?.chapterSummaries?.find(
            (chapter) => chapter.index === item.chapterIndex,
          )?.title ??
          `第 ${item.chapterIndex + 1} 节`,
        available:
          !!book &&
          !book.missingFile &&
          !item.unanchored &&
          !item.archivedSource,
      };
    })
    .sort(
      (a, b) =>
        (filters.order === 'oldest' ? 1 : -1) *
          (a.item.createdAt - b.item.createdAt) ||
        a.item.id.localeCompare(b.item.id),
    );
}
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
export function reviewMarkdown(
  rows: ReviewNote[],
  template: 'quotes' | 'reading' = 'quotes',
) {
  const lines = ['# 微光阅读笔记', ''];
  for (const row of rows) {
    const { item } = row;
    lines.push(
      `## ${escape(row.title.replace(/[\r\n]+/g, ' '))}`,
      '',
      ...item.text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => `> ${escape(line)}`),
      '',
    );
    if (item.note) lines.push('**想法**', '', escape(item.note), '');
    lines.push(
      `来源：${escape(row.chapterTitle)} · ${new Date(item.createdAt).toISOString()}`,
      '',
    );
    if (row.available)
      lines.push(
        `[在本机微光阅读打开原文](jingye://note/${encodeURIComponent(item.bookId)}/${encodeURIComponent(item.id)})`,
        '',
      );
    else lines.push('位置：原书缺失或位置待确认，摘录副本仍可保留。', '');
    if (item.tags?.length)
      lines.push(`标签：${item.tags.map(escape).join('、')}`, '');
    if (template === 'reading')
      lines.push('**回顾问题**：这段文字改变了什么？下一步可以怎样实践？', '');
  }
  return lines.join('\n');
}
