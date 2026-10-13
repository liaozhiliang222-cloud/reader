import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getChapterSummaries,
  getProgress,
  saveProgress,
} from '@/db/repository';
import { ReaderEngine, type ReaderInfo } from '@/reader/ReaderEngine';
import { gestureAction } from '@/reader/gestures';
import { settings, effectiveReading } from '@/app/settings';
import { saveSettings, saveBookSettings } from '@/db/settings';
import { watchAppearance } from '@/app/theme';
import { themePatch } from '@/app/themePreference';
import { ReadingControls } from '@/components/ReadingControls';
import { ContentsDrawer } from './ContentsDrawer';
import { ProgressControl } from './ProgressControl';
import { AnnotationMenu } from './AnnotationMenu';
import { NoteEditor } from './NoteEditor';
import { useAnnotations } from '@/reader/useAnnotations';
import { toggleFullscreen, useImmersive } from '@/reader/useImmersive';
import { isNativeApp, nativeApp } from '@/app/platform';
import { addBookmark, listBookmarks, removeBookmark } from '@/db/bookmarks';
import { QuietHint } from '@/components/QuietHint';
import { TapHint } from '@/components/TapHint';
import { EncodingPanel } from './EncodingPanel';
import { usePresence, useReducedMotion } from '@/components/usePresence';
import { fontState } from '@/app/optionalFont';
import { useBackClose } from '@/app/useBackClose';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { SpeechSetup } from '@/components/SpeechSetup';
import { SpeechBar } from '@/components/SpeechBar';
import { SpeechFollow } from '@/reader/speech/follow';
import {
  speechView,
  connectSpeech,
  startSpeech,
  stopSpeech,
  manualSpeechNavigation,
} from '@/app/speech/coordinator';
import type {
  Book,
  Bookmark,
  ChapterSummary,
  Locator,
  Progress,
  ReadingSettings,
} from '@/types';

export function ReaderView({
  book,
  onBack,
  onBookChanged,
}: {
  book: Book;
  onBack: () => void;
  onBookChanged: (book: Book) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReaderEngine | undefined>(undefined);
  const [reading, setReading] = useState(() =>
    effectiveReading(settings.value.reading, book.settingsOverride),
  );
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const [panel, setPanel] = useState<'typography' | 'more'>();
  const [tapHint] = useState(() => !settings.value.tapHintSeen);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(false);
  menuRef.current = menu;
  useEffect(() => {
    if (!menu) setPanel(undefined);
  }, [menu]);
  const [drawer, setDrawer] = useState(false);
  const [encodingOpen, setEncodingOpen] = useState(false);
  const [linkAddress, setLinkAddress] = useState('');
  const [linkStatus, setLinkStatus] = useState('');
  const reducedMotion = useReducedMotion();
  const fontPhase = fontState.value.phase;
  const menuPresent = usePresence(menu, 180, reducedMotion);
  const drawerPresent = usePresence(drawer, 240, reducedMotion);
  const [chapters, setChapters] = useState<ChapterSummary[]>(
    book.chapterSummaries ?? [],
  );
  const [returnPoint, setReturnPoint] = useState<Locator>();
  const [info, setInfo] = useState<ReaderInfo>({
    title: '',
    chapterIndex: 0,
    page: 1,
    pages: 1,
    percent: 0,
    locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 },
  });
  const [error, setError] = useState('');
  const [speechOpen, setSpeechOpen] = useState(false);
  const speech = speechView.value;
  const speechActive =
    speech.bookId === book.id &&
    ['preparing', 'ready', 'speaking', 'paused'].includes(speech.status);
  const flushManual = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (isNativeApp) void connectSpeech();
  }, []);
  const beginSpeech = async (engine: string, voice: string) => {
    const start = engineRef.current?.currentLocator;
    if (!start) return;
    setSpeechOpen(false);
    setMenu(false);
    await flushManual.current();
    await startSpeech(book, start, engine, voice);
  };
  const speechFollow = useRef(new SpeechFollow());
  useEffect(() => {
    const follow = speechFollow.current.update({
      bookId: book.id,
      snapshot: speech.snapshot,
      detached: speech.detached,
      visible: document.visibilityState === 'visible',
      active: speechActive,
    });
    if (!follow) return;
    if (follow.jump) engineRef.current?.jump(follow.jump, false);
    engineRef.current?.setSpeechRanges(follow.ranges);
  }, [speech.snapshot, speech.detached, speechActive]);
  const annotations = useAnnotations(book, engineRef, setError, () => {
    setMenu(false);
    setDrawer(false);
  });
  const overlayOpen =
    speechOpen ||
    menu ||
    drawer ||
    encodingOpen ||
    !!linkAddress ||
    !!annotations.target ||
    !!annotations.editor;
  const leave = useBackClose(overlayOpen || speechActive, () => {
    if (speechOpen) setSpeechOpen(false);
    else if (linkAddress) setLinkAddress('');
    else if (encodingOpen) setEncodingOpen(false);
    else if (annotations.target || annotations.editor) annotations.close();
    else if (drawer) setDrawer(false);
    else if (menu) setMenu(false);
    else if (speechActive) void stopSpeech();
  });
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const currentBookmarks = engineRef.current?.bookmarksOnPage(bookmarks) ?? [];
  const refreshBookmarks = () => listBookmarks(book.id).then(setBookmarks);
  const deleteBookmark = async (id: string) => {
    try {
      await removeBookmark(book.id, id);
      await refreshBookmarks();
    } catch {
      setError('书签未能移除，请重试。');
    }
  };
  const toggleBookmark = async () => {
    if (bookmarkBusy) return;
    setBookmarkBusy(true);
    try {
      if (currentBookmarks[0])
        await removeBookmark(book.id, currentBookmarks[0].id);
      else {
        const data = engineRef.current?.bookmarkData();
        if (data) await addBookmark(data, book.contentRevision ?? 0);
      }
      await refreshBookmarks();
    } catch {
      setError('书签未能保存，请检查本地存储。');
    } finally {
      setBookmarkBusy(false);
    }
  };
  const { wakeStatus, fullscreen } = useImmersive(reading.wakeLock);
  // 音量键翻页：仅原生 App；开关打开且没有浮层时才接管，离开阅读页恢复调音量。
  useEffect(() => {
    if (!isNativeApp) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void nativeApp().then((native) => {
      if (cancelled) return;
      dispose = native.listenVolumeKey((direction) =>
        engineRef.current?.turn(direction === 'next' ? 1 : -1),
      );
    });
    return () => {
      cancelled = true;
      dispose?.();
      void nativeApp().then((native) => native.setVolumeKeys(false));
    };
  }, []);
  useEffect(() => {
    if (!isNativeApp) return;
    let cancelled = false;
    void nativeApp().then((native) => {
      if (!cancelled)
        void native.setVolumeKeys(
          !!reading.volumeKeys && !overlayOpen && !speechActive,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [reading.volumeKeys, overlayOpen, speechActive]);
  const followSystemTheme = settings.value.followSystemTheme;
  const changeReading = (patch: Partial<ReadingSettings>) => {
    setReading((current) => ({ ...current, ...themePatch(patch, current) }));
    void saveBookSettings(book.id, patch).catch(() =>
      setError('排版未能保存，请检查本地存储。'),
    );
  };
  useEffect(() => {
    return watchAppearance(reading, followSystemTheme);
  }, [reading, followSystemTheme]);
  useEffect(() => {
    let cancelled = false;
    void listBookmarks(book.id)
      .then((items) => {
        if (!cancelled) setBookmarks(items);
      })
      .catch(() => {
        if (!cancelled) setError('无法读取书签。');
      });
    // 新书已随 Book 读入摘要；旧书才需要事务回填目录，避免重复
    // 读取及其写锁延迟紧接着的返回书架操作。
    if (!book.chapterSummaries)
      void getChapterSummaries(book.id)
        .then((value) => {
          if (!cancelled) setChapters(value);
        })
        .catch(() => {
          if (!cancelled) setError('无法读取目录。');
        });
    return () => {
      cancelled = true;
    };
  }, [book.id]);
  useEffect(() => {
    const frame = viewport.current!,
      host = content.current!;
    let disposed = false;
    let latest: Progress | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resizeFrame = 0;
    const persist = async () => {
      clearTimeout(timer);
      if (latest) {
        const value = latest;
        latest = undefined;
        await saveProgress(value, book.contentRevision ?? 0).catch(() => {
          if (!disposed) setError('进度未能保存，请检查浏览器存储空间。');
        });
      }
    };
    flushManual.current = persist;
    const engine = new ReaderEngine(
      book,
      frame,
      host,
      readingRef.current,
      (value) => {
        if (disposed) return;
        annotations.onLocation(value.locator);
        setInfo(value);
        const listening = speechView.value;
        if (
          listening.bookId === book.id &&
          !listening.detached &&
          ['preparing', 'ready', 'speaking', 'paused'].includes(
            listening.status,
          )
        ) {
          clearTimeout(timer);
          return;
        }
        latest = {
          bookId: book.id,
          locator: value.locator,
          percent: value.percent,
          updatedAt: Date.now(),
        };
        clearTimeout(timer);
        timer = setTimeout(persist, 500);
      },
      (cause) => {
        if (!disposed) setError(cause.message);
      },
      (previous) => {
        if (!disposed) setReturnPoint(previous);
      },
      () => manualSpeechNavigation(book.id),
    );
    engineRef.current = engine;
    void engine.start(
      getProgress(book.id).then((progress) => progress?.locator),
    );
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() =>
        engine.configure(readingRef.current),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    window.visualViewport?.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    const hide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', persist);
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          'input, select, textarea, button, dialog, [data-md-link]',
        ) ||
        window.getSelection()?.toString()
      )
        return;
      if (annotations.blockedRef.current) {
        if (event.key === 'Escape') annotations.close();
        return;
      }
      if (
        ['ArrowRight', 'PageDown', ' ', 'ArrowLeft', 'PageUp'].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        engine.turn(['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 1);
      }
      if (event.key === 'Escape') setMenu((value) => !value);
    };
    window.addEventListener('keydown', key);
    let down:
      | { x: number; y: number; time: number; id: number; dragging?: boolean }
      | undefined;
    const selected = () => Boolean(window.getSelection()?.toString());
    // 触摸点按在 pointerup 时就打开/关闭浮层，随后浏览器合成的 click 会落在
    // 刚出现于指下的按钮上；吞掉这一次 click，避免误点目录等按钮。
    // 只拦截同一位置的那次合成 click，其他位置的正常点击不受影响。
    const swallowClick = (x: number, y: number) => {
      const block = (event: MouseEvent) => {
        window.removeEventListener('click', block, true);
        if (
          Math.abs(event.clientX - x) > 16 ||
          Math.abs(event.clientY - y) > 16
        )
          return;
        event.preventDefault();
        event.stopPropagation();
      };
      window.addEventListener('click', block, true);
      setTimeout(() => window.removeEventListener('click', block, true), 400);
    };
    const start = (event: PointerEvent) => {
      if (
        (event.target as Element).closest(
          'button, [data-md-link], [data-md-visual]',
        )
      )
        return;
      engine.stopMotion();
      if (event.isPrimary && !selected())
        down = {
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
          id: event.pointerId,
        };
    };
    const move = (event: PointerEvent) => {
      if (
        !down ||
        menuRef.current ||
        annotations.blockedRef.current ||
        event.pointerId !== down.id ||
        selected() ||
        (!down.dragging && performance.now() - down.time > 500)
      )
        return;
      const dx = event.clientX - down.x;
      if (
        down.dragging ||
        (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(event.clientY - down.y))
      ) {
        down.dragging = true;
        engine.drag(dx);
      }
    };
    const cancel = () => {
      down = undefined;
      engine.cancelDrag();
    };
    const end = (event: PointerEvent) => {
      const origin = down;
      down = undefined;
      if (!origin || selected() || origin.id !== event.pointerId) {
        engine.cancelDrag();
        return;
      }
      if (annotations.blockedRef.current) {
        engine.cancelDrag();
        annotations.close();
        swallowClick(event.clientX, event.clientY);
        return;
      }
      if (menuRef.current) {
        engine.cancelDrag();
        setMenu(false);
        swallowClick(event.clientX, event.clientY);
        return;
      }
      if (
        Math.abs(event.clientX - origin.x) < 10 &&
        Math.abs(event.clientY - origin.y) < 10 &&
        performance.now() - origin.time < 500
      ) {
        const existing = engine.annotationAtPoint(event.clientX, event.clientY);
        if (existing) {
          engine.cancelDrag();
          annotations.openExisting(existing);
          swallowClick(event.clientX, event.clientY);
          return;
        }
      }
      const rect = frame.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      const action = gestureAction(
        event.clientX - origin.x,
        event.clientY - origin.y,
        performance.now() - origin.time,
        x / frame.clientWidth,
        readingRef.current.tapMode,
        x >= 0 && x < 56 && y >= 0 && y < 56,
      );
      if (action === 'next' || action === 'previous')
        engine.turn(action === 'next' ? 1 : -1);
      else {
        engine.cancelDrag();
        if (action === 'menu') {
          setMenu((value) => !value);
          swallowClick(event.clientX, event.clientY);
        }
      }
    };
    frame.addEventListener('pointerdown', start);
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', end);
    frame.addEventListener('pointercancel', cancel);
    const linkClick = (event: MouseEvent) => {
      const button = (event.target as Element).closest<HTMLElement>(
        '[data-md-link]',
      );
      const address = button?.dataset.mdLink;
      if (!address || !frame.contains(button)) return;
      event.preventDefault();
      if (selected()) return;
      if (address.startsWith('#')) {
        let anchor: string;
        try {
          anchor = decodeURIComponent(address.slice(1));
        } catch {
          setError('链接中的标题地址无效。');
          return;
        }
        const entry = book.toc?.find((t) => t.anchor === anchor);
        if (entry)
          engine.jump({
            chapterIndex: entry.chapterIndex,
            paragraphIndex: entry.paragraphIndex,
            charOffset: 0,
          });
        else setError('未找到链接指向的标题。');
      } else {
        setLinkStatus('');
        setLinkAddress(address);
      }
    };
    frame.addEventListener('click', linkClick);
    const linkKey = (event: KeyboardEvent) => {
      const link = (event.target as Element).closest<HTMLElement>(
        '[data-md-link]',
      );
      if (link && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        link.click();
      }
    };
    frame.addEventListener('keydown', linkKey);
    return () => {
      void persist();
      if (speechView.value.bookId === book.id) void stopSpeech();
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = undefined;
      window.visualViewport?.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('keydown', key);
      frame.removeEventListener('pointerdown', start);
      frame.removeEventListener('pointermove', move);
      frame.removeEventListener('pointerup', end);
      frame.removeEventListener('pointercancel', cancel);
      frame.removeEventListener('click', linkClick);
      frame.removeEventListener('keydown', linkKey);
    };
  }, [book]);
  useEffect(() => {
    engineRef.current?.setPageAnimation(reading.pageAnimation);
  }, [reading.pageAnimation]);
  useEffect(() => {
    engineRef.current?.configure(reading);
  }, [
    reading.fontSize,
    reading.lineHeight,
    reading.margin,
    reading.paragraphSpacing,
    reading.indent,
    reading.align,
    reading.fontFamily,
    reading.showHeaderFooter,
    fontPhase,
  ]);
  return (
    <main class={`reader${speechActive ? ' reader-with-speech' : ''}`}>
      {speechOpen && (
        <SpeechSetup
          onClose={() => setSpeechOpen(false)}
          onStart={(engine, voice) => void beginSpeech(engine, voice)}
        />
      )}
      {linkAddress && (
        <Modal title="链接地址" onDismiss={() => setLinkAddress('')}>
          <h2>链接地址</h2>
          <p>可复制到浏览器打开。</p>
          <label class="rename-label">
            地址
            <input
              readOnly
              value={linkAddress}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div class="panel-actions">
            <button onClick={() => setLinkAddress('')}>关闭</button>
            <button
              onClick={() => {
                if (!navigator.clipboard?.writeText) {
                  setLinkStatus('请长按地址复制。');
                  return;
                }
                void navigator.clipboard
                  .writeText(linkAddress)
                  .then(() => setLinkStatus('地址已复制。'))
                  .catch(() => setLinkStatus('请长按地址复制。'));
              }}
            >
              复制地址
            </button>
          </div>
          {linkStatus && <p role="status">{linkStatus}</p>}
        </Modal>
      )}
      {tapHint ? (
        <TapHint
          mode={reading.tapMode}
          onShown={() =>
            void saveSettings({ tapHintSeen: true })
              .then((value) => {
                settings.value = value;
              })
              .catch(() => {})
          }
        />
      ) : (
        <QuietHint enabled={reading.quietHint} />
      )}
      {!!currentBookmarks.length && (
        <span class="reader-bookmark-corner" aria-label="本页有书签">
          ▰
        </span>
      )}
      <div
        class="reader-header"
        aria-hidden="true"
        hidden={!reading.showHeaderFooter}
      >
        {info.title}
      </div>
      <div ref={viewport} class="reader-viewport" aria-label="阅读正文">
        <div ref={content} class="reader-chapters" />
        {reading.tapMode === 'oneHand' && (
          <button
            class="reader-previous-corner"
            aria-label="单手模式：上一页"
            disabled={!!annotations.target || !!annotations.editor}
            onClick={() => {
              if (
                annotations.blockedRef.current ||
                window.getSelection()?.toString()
              )
                return;
              engineRef.current?.turn(-1);
            }}
          >
            ‹
          </button>
        )}
      </div>
      <footer class="reader-footer" hidden={!reading.showHeaderFooter}>
        {info.paginationReady !== false && (
          <>
            {info.page} / {info.pages} ·{' '}
          </>
        )}
        {info.percent.toFixed(1)}%
      </footer>
      {speechActive && !overlayOpen && (
        <SpeechBar onFromPage={() => setSpeechOpen(true)} />
      )}
      {speech.bookId === book.id && speech.error && (
        <p class="reader-error" role="alert">
          {speech.error}
        </p>
      )}
      {error && (
        <p class="reader-error" role="alert">
          {error}
        </p>
      )}
      <button
        class="reader-menu-toggle"
        aria-label="阅读菜单"
        aria-expanded={menu}
        onClick={() => {
          annotations.close();
          setMenu(!menu);
        }}
      >
        ···
      </button>
      {annotations.target && !annotations.editor && (
        <AnnotationMenu
          target={annotations.target}
          busy={annotations.busy}
          onColor={annotations.setColor}
          onNote={() => annotations.openNote()}
          onCopy={() => void annotations.copy()}
          onRemove={annotations.remove}
          onClose={annotations.close}
        />
      )}
      {annotations.editor && (
        <NoteEditor
          target={annotations.editor}
          busy={annotations.busy}
          onSave={annotations.saveNote}
          onClose={annotations.close}
        />
      )}
      {menuPresent && (
        <div
          class={`reader-menu${menu ? '' : ' closing'}`}
          inert={!menu}
          aria-hidden={!menu || undefined}
        >
          <div class="reader-menu-top">
            <button
              class="menu-back"
              aria-label="返回书架"
              onClick={() =>
                leave(() => {
                  void stopSpeech()
                    .then(onBack)
                    .catch(() => setError('听书位置未能保存，请重试。'));
                })
              }
            >
              <Icon name="back" />
              <span>书架</span>
            </button>
            <span class="menu-title">{book.title}</span>
            <button
              class="icon-button"
              aria-label={currentBookmarks.length ? '移除书签' : '添加书签'}
              aria-pressed={!!currentBookmarks.length}
              disabled={bookmarkBusy}
              onClick={() => void toggleBookmark()}
            >
              <Icon name="bookmark" filled={!!currentBookmarks.length} />
            </button>
          </div>
          <div class="reader-menu-bottom">
            {panel === 'typography' && (
              <section class="typography-panel" aria-label="排版与主题">
                <ReadingControls
                  value={reading}
                  onChange={changeReading}
                  followSystemTheme={followSystemTheme}
                />
                <button
                  onClick={() =>
                    void saveSettings({ reading })
                      .then((value) => {
                        settings.value = value;
                        setError('已应用为全局默认');
                      })
                      .catch(() => setError('全局排版保存失败'))
                  }
                >
                  应用为全局默认
                </button>
                <p>调整自动保存为本书排版。</p>
              </section>
            )}
            {panel === 'more' && (
              <section class="more-panel" aria-label="更多">
                {isNativeApp && (
                  <button
                    onClick={() => {
                      setMenu(false);
                      setSpeechOpen(true);
                    }}
                  >
                    听书
                  </button>
                )}
                <label class="check-row">
                  安静提示
                  <input
                    type="checkbox"
                    checked={reading.quietHint}
                    onChange={(e) =>
                      changeReading({ quietHint: e.currentTarget.checked })
                    }
                  />
                </label>
                {book.type === 'txt' && (
                  <button
                    disabled={!engineRef.current?.currentLocator}
                    onClick={() => {
                      annotations.close();
                      void stopSpeech().then(() => setEncodingOpen(true));
                    }}
                  >
                    切换编码
                  </button>
                )}
                {wakeStatus && (
                  <p class="wake-status" role="status">
                    {wakeStatus}
                  </p>
                )}
              </section>
            )}
            {!panel && (
              <div class="menu-progress">
                <button
                  class="icon-button"
                  aria-label="上一页"
                  onClick={() => engineRef.current?.turn(-1)}
                >
                  <Icon name="previous" />
                </button>
                <ProgressControl
                  chapters={chapters}
                  total={book.charCount}
                  percent={info.percent}
                  onCommit={(value) =>
                    engineRef.current?.jumpPercent(value, chapters)
                  }
                />
                <button
                  class="icon-button"
                  aria-label="下一页"
                  onClick={() => engineRef.current?.turn(1)}
                >
                  <Icon name="next" />
                </button>
              </div>
            )}
            {!panel && returnPoint && (
              <button
                class="text-button return-point"
                onClick={() => {
                  engineRef.current?.jump(returnPoint, false);
                  setReturnPoint(undefined);
                }}
              >
                回到跳转前
              </button>
            )}
            <nav class="menu-actions" aria-label="阅读操作">
              <button onClick={() => setDrawer(true)}>
                <Icon name="contents" />
                <span>目录</span>
              </button>
              <button
                aria-label="排版与主题"
                aria-expanded={panel === 'typography'}
                onClick={() =>
                  setPanel(panel === 'typography' ? undefined : 'typography')
                }
              >
                <Icon name="type" />
                <span>排版</span>
              </button>
              <button
                aria-label={fullscreen ? '退出全屏' : '全屏阅读'}
                onClick={() =>
                  void toggleFullscreen().catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : '全屏请求未被允许。',
                    ),
                  )
                }
              >
                <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} />
                <span>{fullscreen ? '退出' : '全屏'}</span>
              </button>
              <button
                aria-expanded={panel === 'more'}
                onClick={() => setPanel(panel === 'more' ? undefined : 'more')}
              >
                <Icon name="more" />
                <span>更多</span>
              </button>
              <button onClick={() => setMenu(false)}>
                <Icon name="done" />
                <span>继续阅读</span>
              </button>
            </nav>
          </div>
        </div>
      )}
      {encodingOpen && (
        <EncodingPanel
          book={book}
          percent={info.percent}
          onClose={() => setEncodingOpen(false)}
          onApplied={onBookChanged}
        />
      )}
      {drawerPresent && (
        <ContentsDrawer
          closing={!drawer}
          book={book}
          chapters={chapters}
          locator={info.locator}
          bookmarks={bookmarks}
          highlights={annotations.items}
          onEditNote={(item) => {
            setDrawer(false);
            annotations.openNote(item);
          }}
          onJumpHighlight={(item) => {
            engineRef.current?.jumpToHighlight(item);
            setDrawer(false);
            setMenu(false);
          }}
          currentBookmarkIds={currentBookmarks.map((bookmark) => bookmark.id)}
          onRemoveBookmark={(id) => void deleteBookmark(id)}
          onClose={() => setDrawer(false)}
          onJump={(locator) => {
            engineRef.current?.jump(locator);
            setDrawer(false);
            setMenu(false);
          }}
        />
      )}
    </main>
  );
}
