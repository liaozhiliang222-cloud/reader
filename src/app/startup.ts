import { t } from '@/i18n';
import { parseRoute } from './router';
import { loadSettings } from '@/db/settings';
import { getBook } from '@/db/repository';
import { incomingStore } from './incoming';
import { validIncomingId } from './incomingData';

export async function loadStartup(hash: string, native = false) {
  const settings = await loadSettings();
  // 原生启动不能重放已消费的分享页面；仍在本机的失败原文件继续保留。
  const previous = parseRoute(hash);
  if (native && previous.page === 'incoming') {
    if (
      !previous.id ||
      !validIncomingId(previous.id) ||
      !(await incomingStore().list()).includes(previous.id)
    )
      hash = '#/';
  }
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
        ? t('这本书待补充原文件，请重新导入。')
        : t('这本书已不存在。')
      : '';
  return {
    settings,
    hash: notice ? '#/' : target,
    book: notice ? undefined : book,
    notice,
  };
}
