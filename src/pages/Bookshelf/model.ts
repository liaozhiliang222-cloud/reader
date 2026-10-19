import { t, uiLocale } from '@/i18n';
import type { AppSettings, Book, Progress } from '@/types';
export interface ShelfEntry {
  book: Book;
  progress?: Progress;
}
export function sortShelf(
  entries: ShelfEntry[],
  sort: AppSettings['shelfSort'],
): ShelfEntry[] {
  const collator = new Intl.Collator(uiLocale.value, {
    numeric: true,
    sensitivity: 'base',
  });
  return entries.slice().sort((a, b) => {
    const compare =
      sort === 'title'
        ? collator.compare(a.book.title, b.book.title)
        : sort === 'imported'
          ? b.book.importedAt - a.book.importedAt
          : b.book.lastReadAt - a.book.lastReadAt;
    return compare || a.book.id.localeCompare(b.book.id);
  });
}
export function relativeRead(updatedAt?: number, now = Date.now()) {
  if (!updatedAt) return t('尚未阅读');
  const days = Math.floor(Math.max(0, now - updatedAt) / 86400000);
  return days === 0
    ? t('今天读过')
    : days === 1
      ? t('昨天读过')
      : t('{0} 天前读过', days);
}
