import { t } from '@/i18n';
import { useEffect, useRef } from 'preact/hooks';
import { BookCover } from '@/components/BookCover';
import { relativeRead, type ShelfEntry } from './model';
import type { Book } from '@/types';

export function BookRow({
  entry,
  onRead,
  onActions,
  virtual,
}: {
  entry: ShelfEntry;
  onRead: (book: Book) => void;
  onActions: (book: Book) => void;
  virtual?: { index: number; count: number; height: number };
}) {
  const { book, progress } = entry;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef({ x: 0, y: 0, blockUntil: 0 });
  const cancel = () => {
    clearTimeout(timer.current);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <li
      class="shelf-row"
      data-shelf-index={virtual?.index}
      aria-posinset={virtual ? virtual.index + 1 : undefined}
      aria-setsize={virtual?.count}
      style={
        virtual
          ? {
              top: `${virtual.index * virtual.height}px`,
              height: `${virtual.height}px`,
            }
          : undefined
      }
    >
      <button
        class="shelf-entry"
        onPointerDown={(event) => {
          cancel();
          if (event.button !== 0) return;
          press.current = { x: event.clientX, y: event.clientY, blockUntil: 0 };
          timer.current = setTimeout(() => {
            press.current.blockUntil = performance.now() + 1000;
            onActions(book);
          }, 600);
        }}
        onPointerMove={(event) => {
          if (
            Math.hypot(
              event.clientX - press.current.x,
              event.clientY - press.current.y,
            ) > 8
          )
            cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(event) => {
          event.preventDefault();
          cancel();
          press.current.blockUntil = performance.now() + 1000;
          onActions(book);
        }}
        onClick={() => {
          cancel();
          if (performance.now() > press.current.blockUntil) onRead(book);
        }}
      >
        <BookCover book={book} />
        <span>
          <strong title={book.title}>{book.title}</strong>
          <small>
            {book.author && `${book.author} · `}
            {book.type === 'paste'
              ? book.draftFormat === 'markdown'
                ? t('Markdown 文稿')
                : t('文稿')
              : book.type.toUpperCase()}{' '}
            · {book.chapterCount} {t('章')}
          </small>
          {!book.missingFile && !!progress && (
            <span
              class="shelf-progress"
              aria-hidden="true"
              style={{ '--progress': `${Math.min(100, progress.percent)}%` }}
            />
          )}
          <small>
            {book.missingFile
              ? t('待补充文件')
              : !progress
                ? t('未读')
                : `${progress.percent >= 100 ? t('已读完') : `${progress.percent.toFixed(1)}%`} · ${relativeRead(progress.updatedAt)}`}
          </small>
        </span>
      </button>
      <button
        class="shelf-more"
        aria-label={t('《{0}》的书籍操作', book.title)}
        onClick={() => onActions(book)}
      >
        ⋮
      </button>
    </li>
  );
}
