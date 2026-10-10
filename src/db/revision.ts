import type { Book } from '@/types';

export const contentRevision = (book: Book) => book.contentRevision ?? 0;
export function assertContentRevision(book: Book, expected: number) {
  if (contentRevision(book) !== expected)
    throw new Error('书籍内容已在其他页面更新，请返回书架重新打开。');
}
