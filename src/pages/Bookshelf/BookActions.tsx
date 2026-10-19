import { t, uiLocale } from '@/i18n';
import { useEffect, useState } from 'preact/hooks';
import { Modal } from '@/components/Modal';
import { countAnnotations, deleteBook, renameBook } from '@/db/repository';
import { navigate } from '@/app/router';
import type { Book } from '@/types';
import { resetSpeechData } from '@/app/speech/coordinator';

export function BookActions({
  book,
  onClose,
  onChange,
}: {
  book: Book;
  onClose: () => void;
  onChange: () => void;
}) {
  const [page, setPage] = useState<'menu' | 'rename' | 'info' | 'delete'>(
    'menu',
  );
  const [title, setTitle] = useState(book.title);
  const [counts, setCounts] = useState<{
    bookmarks: number;
    highlights: number;
  }>();
  const [keepNotes, setKeepNotes] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void countAnnotations(book.id)
      .then((value) => {
        if (!cancelled) setCounts(value);
      })
      .catch(() => {
        if (!cancelled) setError(t('无法读取书签与笔记数量。'));
      });
    return () => {
      cancelled = true;
    };
  }, [book.id]);
  const commit = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onChange();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('操作失败，请重试。'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={page === 'delete' ? t('确认删除书籍') : t('书籍操作')}
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <header class="panel-heading">
        <h2>
          {page === 'rename'
            ? t('重命名')
            : page === 'info'
              ? t('书籍信息')
              : page === 'delete'
                ? t('删除书籍')
                : book.title}
        </h2>
        <button disabled={busy} onClick={onClose}>
          {t('关闭')}
        </button>
      </header>
      {page === 'menu' && (
        <div class="book-action-list">
          <button onClick={() => setPage('rename')}>{t('重命名')}</button>
          <button onClick={() => setPage('info')}>{t('查看信息')}</button>
          <button onClick={() => setPage('delete')}>{t('删除书籍')}</button>
        </div>
      )}
      {page === 'rename' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void commit(() => renameBook(book.id, title));
          }}
        >
          <label class="rename-label">
            {t('书名')}
            <input
              value={title}
              maxLength={200}
              disabled={busy}
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          <div class="panel-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPage('menu')}
            >
              {t('取消')}
            </button>
            <button disabled={busy || !title.trim()} type="submit">
              {t('保存书名')}
            </button>
          </div>
        </form>
      )}
      {page === 'info' && (
        <>
          <dl class="book-info">
            <dt>{t('书名')}</dt>
            <dd>{book.title}</dd>
            {book.author && (
              <>
                <dt>{t('作者')}</dt>
                <dd>{book.author}</dd>
              </>
            )}
            <dt>{t('格式')}</dt>
            <dd>
              {book.type === 'paste'
                ? book.draftFormat === 'markdown'
                  ? t('Markdown 文稿')
                  : t('文稿')
                : book.type.toUpperCase()}
              {book.encoding && ` · ${book.encoding}`}
            </dd>
            <dt>{t('大小')}</dt>
            <dd>{(book.size / 1024).toFixed(1)} KB</dd>
            <dt>{t('字数')}</dt>
            <dd>
              {book.charCount.toLocaleString(uiLocale.value)} {t('字 ·')}{' '}
              {book.chapterCount} {t('章')}
            </dd>
            <dt>{t('导入时间')}</dt>
            <dd>{new Date(book.importedAt).toLocaleString(uiLocale.value)}</dd>
            <dt>{t('书签与笔记')}</dt>
            <dd>
              {counts
                ? t(
                    '{0} 个书签 · {1} 条划线笔记',
                    counts.bookmarks,
                    counts.highlights,
                  )
                : t('正在读取…')}
            </dd>
          </dl>
          {book.type === 'paste' && (
            <button
              onClick={() => {
                onClose();
                navigate('#/paste/' + encodeURIComponent(book.id));
              }}
            >
              {t('编辑正文')}
            </button>
          )}
        </>
      )}
      {page === 'delete' && (
        <>
          <label class="check-row">
            <input
              type="checkbox"
              checked={keepNotes}
              onChange={(e) => setKeepNotes(e.currentTarget.checked)}
            />
            {t('保留划线和想法副本（删除后不能回到原文）')}
          </label>
          <p>
            {counts
              ? t(
                  '确认删除《{0}》？原文件、阅读进度、{1} 个书签{2}将一起删除，此操作无法撤销。',
                  book.title,
                  counts.bookmarks,
                  keepNotes ? '' : t('和 {0} 条划线笔记', counts.highlights),
                )
              : t('正在读取…')}
          </p>
          <div class="panel-actions">
            <button disabled={busy} onClick={() => setPage('menu')}>
              {t('取消')}
            </button>
            <button
              disabled={busy || !counts}
              onClick={() =>
                void commit(async () => {
                  await resetSpeechData();
                  await deleteBook(book.id, keepNotes);
                })
              }
            >
              {t('确认删除')}
            </button>
          </div>
        </>
      )}
      {busy && <p role="status">{t('正在保存…')}</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
