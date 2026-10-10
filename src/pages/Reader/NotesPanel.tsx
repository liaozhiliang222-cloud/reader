import { useState } from 'preact/hooks';
import { groupHighlights } from '@/reader/annotation';
import { notesFilename, notesMarkdown } from '@/reader/exportNotes';
import { downloadBlob, shareMarkdown } from '@/app/files';
import { isNativeApp } from '@/app/platform';
import type { Book, ChapterSummary, Highlight } from '@/types';

export function NotesPanel({
  book,
  chapters,
  items,
  onJump,
  onEdit,
}: {
  book: Book;
  chapters: ChapterSummary[];
  items: Highlight[];
  onJump: (item: Highlight) => void;
  onEdit: (item: Highlight) => void;
}) {
  const [error, setError] = useState(''),
    [sharing, setSharing] = useState(false);
  const markdown = () => notesMarkdown(book, chapters, items);
  const name = notesFilename(book.title);
  const share = async () => {
    setSharing(true);
    try {
      await shareMarkdown(markdown(), name, book.title);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError('分享未能完成，请使用下载。');
    } finally {
      setSharing(false);
    }
  };
  if (!items.length)
    return <p class="muted">还没有划线或笔记。长按正文选中文字后即可添加。</p>;
  return (
    <>
      <div class="notes-export">
        <button
          onClick={() => {
            void Promise.resolve(
              downloadBlob(
                new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }),
                name,
              ),
            ).catch((cause) => {
              if (!(
                cause instanceof DOMException && cause.name === 'AbortError'
              ))
                setError('下载未能开始，请尝试分享。');
            });
          }}
        >
          下载 Markdown
        </button>
        {(typeof navigator.share === 'function' || isNativeApp) && (
          <button disabled={sharing} onClick={() => void share()}>
            {sharing ? '分享中…' : '分享笔记'}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {groupHighlights(items).map((group) => (
        <section key={group.chapterIndex} class="note-group">
          <h3>
            {group.chapterIndex < 0
              ? '位置待确认'
              : (chapters.find(
                  (chapter) => chapter.index === group.chapterIndex,
                )?.title ?? `第 ${group.chapterIndex + 1} 节`)}
          </h3>
          <ol class="notes-list">
            {group.highlights.map((item) => (
              <li key={item.id}>
                <button
                  class="note-jump"
                  data-color={item.color}
                  disabled={item.unanchored}
                  onClick={() => onJump(item)}
                  aria-label={`跳转到划线：${[...item.text].slice(0, 30).join('')}`}
                >
                  <span class="note-quote">{item.text}</span>
                  {item.note && <span class="note-content">{item.note}</span>}
                  <small>
                    {item.unanchored && '编码切换前的摘录 · '}
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </small>
                </button>
                <button onClick={() => onEdit(item)}>
                  {item.note ? '编辑笔记' : '添加笔记'}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
