import { parseRoute } from './router';
import { loadSettings } from '@/db/settings';
import { getBook } from '@/db/repository';

export async function loadStartup(hash: string) {
  const settings = await loadSettings();
  const target =
    !hash && settings.autoResume && settings.lastBookId
      ? '#/read/' + encodeURIComponent(settings.lastBookId)
      : hash;
  const route = parseRoute(target);
  const book =
    route.page === 'reader' ? await getBook(route.bookId) : undefined;
  const notice =
    route.page === 'reader' && (!book || book.missingFile)
      ? book
        ? '这本书待补充原文件，请重新导入。'
        : '这本书已不存在。'
      : '';
  return {
    settings,
    hash: notice ? '#/' : target,
    book: notice ? undefined : book,
    notice,
  };
}
