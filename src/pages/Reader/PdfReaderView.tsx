import { useEffect, useRef, useState } from 'preact/hooks';
import { getBlob, getProgress, saveProgress } from '@/db/repository';
import { openNativePdf } from '@/app/platform/documents';
import { settings, effectiveReading } from '@/app/settings';
import { watchAppearance } from '@/app/theme';
import { t } from '@/i18n';
import type { Book, ReadingLocation } from '@/types';
import './pdf.css';

type PdfLocation = Extract<ReadingLocation, { kind: 'pdf' }>;
const initial: PdfLocation = {
  kind: 'pdf',
  pageIndex: 0,
  x: 0,
  y: 0,
  scale: 1,
};
const scales = [0.5, 0.75, 1, 1.5, 2, 3, 4];

export function PdfReaderView({
  book,
  onBack,
}: {
  book: Book;
  onBack(): void;
}) {
  const [at, setAt] = useState<PdfLocation>(initial),
    [image, setImage] = useState(''),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [pageInput, setPageInput] = useState('1');
  const [size, setSize] = useState({ width: 1, height: 1 }),
    [viewportWidth, setViewportWidth] = useState(400);
  const view = useRef<HTMLDivElement>(null),
    session = useRef<Awaited<ReturnType<typeof openNativePdf>> | undefined>(
      undefined,
    ),
    position = useRef(initial),
    loaded = useRef(false);
  const persist = () =>
    loaded.current
      ? saveProgress(
          {
            bookId: book.id,
            locator: {
              chapterIndex: position.current.pageIndex,
              paragraphIndex: 0,
              charOffset: 0,
            },
            location: { ...position.current },
            percent:
              ((position.current.pageIndex + 1) / book.chapterCount) * 100,
            updatedAt: Date.now(),
          },
          book.contentRevision ?? 0,
        )
      : Promise.resolve();
  const reading = effectiveReading(
    settings.value.reading,
    book.settingsOverride,
  );
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const restoringScroll = useRef(true);
  const restoreFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(restoreFrame.current), []);
  useEffect(
    () => watchAppearance(reading, settings.value.followSystemTheme),
    [reading.theme],
  );
  useEffect(() => setPageInput(String(at.pageIndex + 1)), [at.pageIndex]);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    void (async () => {
      const source = await getBlob(book.fileBlobId ?? book.id);
      if (!source) throw new Error(t('本机缺少 PDF 原文件，请重新导入。'));
      const saved = (await getProgress(book.id))?.location;
      const current =
        saved?.kind === 'pdf' && saved.pageIndex < book.chapterCount
          ? saved
          : initial;
      position.current = current;
      setAt(current);
      const document = await openNativePdf(source.data, controller.signal);
      if (!live) {
        await document.close();
        return;
      }
      if (document.pageCount !== book.chapterCount) {
        await document.close();
        throw new Error(t('PDF 页数与保存记录不一致，请重新导入。'));
      }
      session.current = document;
      loaded.current = true;
      setReady(true);
    })().catch((cause) => {
      if (live)
        setError(cause instanceof Error ? cause.message : t('PDF 无法打开。'));
    });
    return () => {
      live = false;
      controller.abort();
      clearTimeout(scrollTimer.current);
      void persist().catch(() => {});
      loaded.current = false;
      const document = session.current;
      session.current = undefined;
      void document?.close().catch(() => {});
    };
  }, [book.id]);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setViewportWidth(view.current?.clientWidth ?? 400),
    );
    if (view.current) observer.observe(view.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    const document = session.current;
    if (!ready || !document) return;
    cancelAnimationFrame(restoreFrame.current);
    restoringScroll.current = true;
    setImage('');
    void document
      .render(
        at.pageIndex,
        Math.max(
          100,
          Math.min(
            4096,
            Math.round(
              viewportWidth * Math.min(devicePixelRatio, 2) * at.scale,
            ),
          ),
        ),
      )
      .then((result) => {
        if (live) {
          setSize({ width: result.width, height: result.height });
          setImage('data:image/png;base64,' + result.data);
          setError('');
        }
      })
      .catch((cause) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : t('PDF 页面渲染失败。'),
          );
      });
    return () => {
      live = false;
    };
  }, [ready, at.pageIndex, at.scale, viewportWidth]);
  const move = (patch: Partial<PdfLocation>) => {
    const current = { ...position.current, ...patch };
    position.current = current;
    setAt(current);
    void persist().catch(() => setError(t('PDF 进度未能保存。')));
  };
  const goToPage = () => {
    const page = Number(pageInput);
    if (Number.isInteger(page) && page >= 1 && page <= book.chapterCount) {
      if (page - 1 !== at.pageIndex) move({ pageIndex: page - 1, x: 0, y: 0 });
    } else setPageInput(String(at.pageIndex + 1));
  };
  useEffect(() => {
    const hide = () => {
      void persist().catch(() => setError(t('PDF 进度未能保存。')));
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
    };
  }, [book.id]);
  return (
    <main class="pdf-reader">
      <header>
        <button
          onClick={() => {
            void persist()
              .then(onBack)
              .catch(() => setError(t('PDF 进度未能保存，请重试返回。')));
          }}
        >
          {t('返回书架')}
        </button>
        <h1>{book.title}</h1>
      </header>
      <div class="pdf-controls">
        <button
          disabled={!ready || at.pageIndex === 0}
          onClick={() => move({ pageIndex: at.pageIndex - 1, x: 0, y: 0 })}
        >
          {t('上一页')}
        </button>
        <label>
          {t('页码')}{' '}
          <input
            aria-label={t('PDF 页码')}
            type="number"
            inputMode="numeric"
            disabled={!ready}
            min={1}
            max={book.chapterCount}
            value={pageInput}
            onInput={(e) => setPageInput(e.currentTarget.value)}
            onChange={goToPage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />{' '}
          / {book.chapterCount}
        </label>
        <button
          disabled={!ready || at.pageIndex + 1 === book.chapterCount}
          onClick={() => move({ pageIndex: at.pageIndex + 1, x: 0, y: 0 })}
        >
          {t('下一页')}
        </button>
        <label>
          {t('缩放')}{' '}
          <select
            aria-label={t('PDF 缩放')}
            value={at.scale}
            disabled={!ready}
            onChange={(e) => move({ scale: Number(e.currentTarget.value) })}
          >
            {scales.map((scale) => (
              <option key={scale} value={scale}>
                {scale * 100}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={view}
        class="pdf-viewport"
        onScroll={() => {
          if (view.current && image && !restoringScroll.current) {
            const frame = view.current;
            position.current = {
              ...position.current,
              x: frame.scrollLeft / Math.max(1, frame.scrollWidth),
              y: frame.scrollTop / Math.max(1, frame.scrollHeight),
            };
            clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => {
              void persist().catch(() => setError(t('PDF 进度未能保存。')));
            }, 300);
          }
        }}
      >
        {image ? (
          <img
            class="pdf-page"
            src={image}
            alt={t('PDF 第 {0} 页', at.pageIndex + 1)}
            style={{
              width: `${viewportWidth * at.scale}px`,
              aspectRatio: `${size.width} / ${size.height}`,
            }}
            onLoad={() => {
              if (view.current) {
                const frame = view.current;
                frame.scrollLeft = Math.min(
                  Math.max(0, frame.scrollWidth - frame.clientWidth),
                  position.current.x * frame.scrollWidth,
                );
                frame.scrollTop = Math.min(
                  Math.max(0, frame.scrollHeight - frame.clientHeight),
                  position.current.y * frame.scrollHeight,
                );
                cancelAnimationFrame(restoreFrame.current);
                restoreFrame.current = requestAnimationFrame(() => {
                  restoringScroll.current = false;
                });
              }
            }}
          />
        ) : (
          !error && <p role="status">{t('正在渲染当前页…')}</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <footer>
        {t(
          '原页阅读 · 支持翻页、缩放和进度续读；暂不支持原页划线、笔记、听书或文字识别。',
        )}
      </footer>
    </main>
  );
}
