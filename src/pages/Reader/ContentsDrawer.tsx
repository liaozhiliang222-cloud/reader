import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Modal } from '@/components/Modal';
import { TOC_ROW_HEIGHT, visibleRange } from './virtual';
import { NotesPanel } from './NotesPanel';
import { beginMeasure } from '@/app/performance';
import type {
  Book,
  Bookmark,
  ChapterSummary,
  Highlight,
  Locator,
} from '@/types';

export function ContentsDrawer({
  book,
  chapters,
  locator,
  bookmarks,
  highlights,
  onEditNote,
  onJumpHighlight,
  currentBookmarkIds,
  onRemoveBookmark,
  onClose,
  onJump,
  closing = false,
}: {
  book: Book;
  chapters: ChapterSummary[];
  locator: Locator;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  onEditNote: (item: Highlight) => void;
  onJumpHighlight: (item: Highlight) => void;
  currentBookmarkIds: string[];
  onRemoveBookmark: (id: string) => void;
  onClose: () => void;
  onJump: (locator: Locator) => void;
  closing?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focusFrame = useRef(0);
  const initialFrame = useRef(0);
  const [focused, setFocused] = useState<number>();
  const [chapterInput, setChapterInput] = useState('');
  const [tab, setTab] = useState<'contents' | 'bookmarks' | 'notes'>(
    'contents',
  );
  const [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(480);
  const entries = useMemo(
    () =>
      book.toc?.length
        ? book.toc
        : chapters.map((chapter) => ({
            title: chapter.title,
            chapterIndex: chapter.index,
            paragraphIndex: 0,
            level: chapter.level ?? 0,
          })),
    [book.toc, chapters],
  );
  let active = entries.findIndex(
    (entry) => entry.chapterIndex === locator.chapterIndex,
  );
  entries.forEach((entry, index) => {
    if (
      entry.chapterIndex === locator.chapterIndex &&
      entry.paragraphIndex <= locator.paragraphIndex
    )
      active = index;
  });
  const { start, end } = visibleRange(entries.length, scroll, height);
  const indices = Array.from(
    { length: end - start },
    (_, offset) => start + offset,
  );
  if (
    focused !== undefined &&
    focused < entries.length &&
    !indices.includes(focused)
  )
    indices.push(focused);
  indices.sort((a, b) => a - b);
  const focusAt = (index: number) => {
    const root = list.current!;
    // Explicit navigation wins over the pending initial centering operation.
    cancelAnimationFrame(initialFrame.current);
    setFocused(index);
    root.scrollTop = index * TOC_ROW_HEIGHT;
    setScroll(root.scrollTop);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() =>
      root
        .querySelector<HTMLButtonElement>(`[data-toc-index="${index}"] button`)
        ?.focus({ preventScroll: true }),
    );
  };
  const jumpToChapter = () => {
    const value = Number.parseInt(chapterInput, 10);
    if (!Number.isFinite(value) || !chapters.length) return;
    const target = Math.max(0, Math.min(chapters.length - 1, value - 1));
    const index = entries.findIndex((entry) => entry.chapterIndex >= target);
    if (index >= 0) focusAt(index);
  };
  useLayoutEffect(() => {
    if (tab !== 'contents') {
      setFocused(undefined);
      return;
    }
    const end = beginMeasure('目录视口呈现');
    const root = list.current!;
    const resize = new ResizeObserver(() => setHeight(root.clientHeight));
    resize.observe(root);
    initialFrame.current = requestAnimationFrame(() => {
      root.scrollTop = Math.max(
        0,
        active * TOC_ROW_HEIGHT - root.clientHeight / 2,
      );
      setScroll(root.scrollTop);
      setHeight(root.clientHeight);
      end();
    });
    return () => {
      cancelAnimationFrame(initialFrame.current);
      cancelAnimationFrame(focusFrame.current);
      resize.disconnect();
      end(false);
    };
  }, [active, tab]);
  return (
    <Modal
      title="目录、书签与笔记"
      className={`reader-drawer${closing ? ' closing' : ''}`}
      closing={closing}
      onDismiss={onClose}
    >
      <div class="reader-drawer-body">
        <header class="panel-heading">
          <h2>阅读导航</h2>
          <button onClick={onClose}>关闭</button>
        </header>
        <div role="tablist" aria-label="阅读导航" class="drawer-tabs">
          <button
            role="tab"
            aria-selected={tab === 'contents'}
            id="contents-tab"
            aria-controls="contents-panel"
            onClick={() => setTab('contents')}
          >
            目录
          </button>
          <button
            role="tab"
            aria-selected={tab === 'bookmarks'}
            id="bookmarks-tab"
            aria-controls="bookmarks-panel"
            onClick={() => setTab('bookmarks')}
          >
            书签
          </button>
          <button
            role="tab"
            aria-selected={tab === 'notes'}
            id="notes-tab"
            aria-controls="notes-panel"
            onClick={() => setTab('notes')}
          >
            笔记
          </button>
        </div>
        {entries.length > 40 && (
          <form
            class="toc-nav"
            hidden={tab !== 'contents'}
            onSubmit={(event) => {
              event.preventDefault();
              jumpToChapter();
            }}
          >
            <button
              type="button"
              class="text-button"
              onClick={() => focusAt(Math.max(0, active))}
            >
              回到当前
            </button>
            <label>
              跳至
              <input
                type="number"
                min={1}
                max={chapters.length}
                inputMode="numeric"
                value={chapterInput}
                aria-label="章节号"
                onInput={(event) => setChapterInput(event.currentTarget.value)}
              />
              章
            </label>
            <button type="submit">前往</button>
          </form>
        )}
        <div
          role="tabpanel"
          hidden={tab !== 'contents'}
          id="contents-panel"
          aria-labelledby="contents-tab"
          class="toc-viewport"
          ref={list}
          onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
          onFocusCapture={(event) => {
            const row = (event.target as Element).closest<HTMLElement>(
              '[data-toc-index]',
            );
            if (row) setFocused(Number(row.dataset.tocIndex));
          }}
          onBlurCapture={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setFocused(undefined);
          }}
          onKeyDown={(event) => {
            const row = (event.target as Element).closest<HTMLElement>(
              '[data-toc-index]',
            );
            if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
            const index = Number(row.dataset.tocIndex);
            let next = index;
            if (event.key === 'ArrowDown') next++;
            else if (event.key === 'ArrowUp') next--;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = entries.length - 1;
            else if (event.key === 'Tab') {
              next += event.shiftKey ? -1 : 1;
              if (next < 0 || next >= entries.length) return;
            } else return;
            event.preventDefault();
            focusAt(Math.max(0, Math.min(entries.length - 1, next)));
          }}
        >
          {!entries.length ? (
            <p role="status">正在读取目录…</p>
          ) : (
            <ol
              class="toc-list"
              style={{ height: `${entries.length * TOC_ROW_HEIGHT}px` }}
            >
              {indices.map((index) => {
                const entry = entries[index]!;
                return (
                  <li
                    aria-posinset={index + 1}
                    aria-setsize={entries.length}
                    data-toc-index={index}
                    key={index}
                    style={{
                      top: `${index * TOC_ROW_HEIGHT}px`,
                      height: `${TOC_ROW_HEIGHT}px`,
                    }}
                  >
                    <button
                      style={{
                        paddingLeft: `${16 + Math.min(8, Math.max(0, entry.level)) * 16}px`,
                      }}
                      aria-current={index === active ? 'location' : undefined}
                      title={entry.title}
                      aria-label={`跳转到${entry.title}`}
                      onClick={() =>
                        onJump({
                          chapterIndex: entry.chapterIndex,
                          paragraphIndex: entry.paragraphIndex,
                          charOffset: 0,
                        })
                      }
                    >
                      {entry.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div
          role="tabpanel"
          id="bookmarks-panel"
          aria-labelledby="bookmarks-tab"
          hidden={tab !== 'bookmarks'}
          class="bookmark-panel"
        >
          {!bookmarks.length ? (
            <p class="muted">还没有书签。在阅读菜单中添加，即可随时回来。</p>
          ) : (
            <ol class="bookmark-list">
              {bookmarks.map((bookmark) => (
                <li key={bookmark.id}>
                  <button
                    class="bookmark-jump"
                    disabled={bookmark.unanchored}
                    aria-current={
                      currentBookmarkIds.includes(bookmark.id)
                        ? 'location'
                        : undefined
                    }
                    onClick={() => onJump(bookmark.locator)}
                  >
                    <strong>{bookmark.chapterTitle}</strong>
                    <span>{bookmark.excerpt || '图片或章节开头'}</span>
                    <small>
                      {bookmark.unanchored && '位置待确认 · '}
                      {new Date(bookmark.createdAt).toLocaleDateString('zh-CN')}
                    </small>
                  </button>
                  <button
                    aria-label={`移除${bookmark.chapterTitle}的书签`}
                    onClick={() => onRemoveBookmark(bookmark.id)}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div
          role="tabpanel"
          id="notes-panel"
          aria-labelledby="notes-tab"
          hidden={tab !== 'notes'}
          class="notes-panel"
        >
          <NotesPanel
            book={book}
            chapters={chapters}
            items={highlights}
            onJump={onJumpHighlight}
            onEdit={onEditNote}
          />
        </div>
      </div>
    </Modal>
  );
}
