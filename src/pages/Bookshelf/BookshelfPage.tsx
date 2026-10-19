import { t, uiLocale } from '@/i18n';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { listShelf } from '@/db/repository';
import { navigate } from '@/app/router';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import { ImportSheet } from '@/pages/Import/ImportSheet';
import { sortShelf, type ShelfEntry } from './model';
import { VirtualShelf } from './VirtualShelf';
import { beginMeasure } from '@/app/performance';
import { BookActions } from './BookActions';
import { tryReaderFullscreen } from '@/reader/useImmersive';
import type { AppSettings, Book } from '@/types';
import { UpdateNotice } from '@/components/UpdateNotice';
import { incomingStore, incomingRevision } from '@/app/incoming';
import { EnvironmentNotice } from '@/components/EnvironmentNotice';
import { BackupReminder } from '@/components/BackupReminder';

export function BookshelfPage({ notice }: { notice?: string }) {
  const [entries, setEntries] = useState<ShelfEntry[]>([]),
    [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false),
    [selected, setSelected] = useState<Book>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  const pendingRevision = incomingRevision.value;
  useEffect(() => {
    let live = true;
    void incomingStore()
      .list()
      .then((ids) => {
        if (live) setPending(ids);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pendingRevision]);
  const sort = settings.value.shelfSort;
  useEffect(() => {
    let cancelled = false;
    const end = beginMeasure(t('书架数据读取'));
    void listShelf()
      .then((value) => {
        if (!cancelled) setEntries(value);
      })
      .catch(() => {
        if (!cancelled) setError(t('无法访问本地存储，请检查浏览器设置。'));
      })
      .finally(() => {
        end(!cancelled);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      end(false);
    };
  }, [revision]);
  const books = useMemo(
    () => sortShelf(entries, sort),
    [entries, sort, uiLocale.value],
  );
  const recent = entries
    .filter((entry) => entry.progress && !entry.book.missingFile)
    .sort((a, b) => b.book.lastReadAt - a.book.lastReadAt)[0];
  const read = (book: Book) => {
    if (book.missingFile) {
      setError(t('请选择这本书的原文件，导入后会挂接已有进度与笔记。'));
      setImportOpen(true);
    } else {
      tryReaderFullscreen();
      navigate('#/read/' + encodeURIComponent(book.id));
    }
  };
  const updateSort = async (value: AppSettings['shelfSort']) => {
    try {
      settings.value = await saveSettings({ shelfSort: value });
    } catch {
      setError(t('排序保存失败，请重试。'));
    }
  };
  return (
    <main class="welcome">
      <header class="masthead">
        <span class="wordmark">{t('微光阅读')}</span>
        <button onClick={() => navigate('#/notes')}>{t('笔记')}</button>
        <button
          aria-label={t('设置与数据管理')}
          onClick={() => navigate('#/settings')}
        >
          {t('设置')}
        </button>
      </header>
      <UpdateNotice />
      <EnvironmentNotice />
      <BackupReminder revision={revision} />
      {!!pending.length && (
        <aside class="update-notice">
          <p>{t('有 {0} 份分享尚未处理，原文仍在本机。', pending.length)}</p>
          <button onClick={() => navigate('#/incoming/' + pending[0])}>
            {t('继续导入分享')}
          </button>
        </aside>
      )}
      {loading ? (
        <section class="welcome-body">
          <p role="status">{t('正在打开书架…')}</p>
        </section>
      ) : !books.length ? (
        <section class="welcome-body" aria-labelledby="welcome-title">
          <span class="book-symbol" aria-hidden="true">
            {t('页')}
          </span>
          <p class="eyebrow">{t('留一点时间，给阅读。')}</p>
          <h1 id="welcome-title">
            {t('一页书，')}
            <br />
            {t('一会儿安静。')}
          </h1>
          <p class="intro">
            {t('从信息流中暂时抽身。')}
            <br />
            {t('让文字回到纸上，让注意力回到此刻。')}
          </p>
          <button class="import-button" onClick={() => setImportOpen(true)}>
            {t('导入第一本书')}
          </button>
        </section>
      ) : (
        <section class="bookshelf">
          <div class="shelf-heading">
            <h1>{t('我的书架')}</h1>
            <button class="primary-action" onClick={() => setImportOpen(true)}>
              {t('＋ 导入书籍')}
            </button>
          </div>
          {recent && (
            <button class="resume-card" onClick={() => read(recent.book)}>
              <small>
                {t('继续阅读 ·')} {(recent.progress?.percent ?? 0).toFixed(1)}%
              </small>
              <strong>{recent.book.title}</strong>
              <span aria-hidden="true">→</span>
            </button>
          )}
          <label class="shelf-sort">
            {t('排序')}
            <select
              value={sort}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (
                  value === 'recent' ||
                  value === 'imported' ||
                  value === 'title'
                )
                  void updateSort(value);
              }}
            >
              <option value="recent">{t('最近阅读')}</option>
              <option value="imported">{t('导入时间')}</option>
              <option value="title">{t('书名')}</option>
            </select>
          </label>
          <VirtualShelf entries={books} onRead={read} onActions={setSelected} />
        </section>
      )}
      {(error || notice) && <p role="alert">{error || notice}</p>}
      {importOpen && (
        <ImportSheet
          onClose={() => setImportOpen(false)}
          onComplete={(items) => {
            setRevision((n) => n + 1);
            if (
              items.length === 1 &&
              items[0]?.status === 'success' &&
              items[0].book
            ) {
              setImportOpen(false);
              read(items[0].book);
            }
          }}
        />
      )}
      {selected && (
        <BookActions
          book={selected}
          onClose={() => setSelected(undefined)}
          onChange={() => setRevision((n) => n + 1)}
        />
      )}
      <footer>{t('无注册 · 无推荐 · 无 AI')}</footer>
    </main>
  );
}
