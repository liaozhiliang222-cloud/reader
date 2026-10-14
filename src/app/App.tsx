import { useEffect, useRef, useState } from 'preact/hooks';
import { getBook } from '@/db/repository';
import { useRoute, navigate, parseRoute } from '@/app/router';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import { watchAppearance } from '@/app/theme';
import { SettingsPage } from '@/pages/Settings/SettingsPage';
import { BookshelfPage } from '@/pages/Bookshelf/BookshelfPage';
import { PastePage } from '@/pages/Import/PastePage';
import { ReaderView } from '@/pages/Reader/ReaderView';
import type { Book } from '@/types';
import { requestPersistence } from './storage';
import { startPwa } from './pwa';
import { loadStartup } from './startup';
import { IncomingPage } from '@/pages/Import/IncomingPage';
import { incomingStore, incomingChanged } from './incoming';
import { installFileConsumer, type LaunchHost } from './fileLaunch';
import { Onboarding } from '@/pages/Onboarding/Onboarding';
import { restoreOptionalFont } from './optionalFont';
import { NotesPage } from '@/pages/Notes/NotesPage';
import { connectPro } from './pro';
import { AboutPage } from '@/pages/About/AboutPage';
import { isNativeApp, isAndroidApp, nativeApp } from './platform';
import type { IncomingData } from './incomingData';
import { validIncomingId } from './incomingData';
import type { NativeImportProgress } from './platform/native';
import { BookLoading } from '@/components/BookLoading';
import { Modal } from '@/components/Modal';

export function App() {
  const route = useRoute();
  useEffect(() => {
    void connectPro();
  }, []);
  const [ready, setReady] = useState(false);
  const [nativeLaunching, setNativeLaunching] = useState(isNativeApp);
  const [receiving, setReceiving] = useState<NativeImportProgress>();
  const [guide, setGuide] = useState(false);
  const globalReading = settings.value.reading;
  const followSystemTheme = settings.value.followSystemTheme;
  const [active, setActive] = useState<Book>();
  const [error, setError] = useState('');
  const startupBook = useRef<Book | undefined>(undefined);
  const checkUpdates = settings.value.checkUpdates;
  useEffect(() => {
    if (ready) startPwa(checkUpdates);
  }, [ready, checkUpdates]);
  useEffect(() => {
    if (!ready) return;
    const deliver = async (data: IncomingData) => {
      const id = crypto.randomUUID();
      await incomingStore().put(id, data);
      incomingChanged();
      const current = parseRoute(location.hash);
      if (
        current.page !== 'paste' &&
        (current.page !== 'incoming' ||
          !current.id ||
          !validIncomingId(current.id))
      )
        navigate('#/incoming/' + id, current.page === 'incoming');
    };
    installFileConsumer(window as Window & LaunchHost, deliver, () =>
      setError('未能接收系统打开的文件，请从书架重新选择。'),
    );
    if (!isNativeApp) return;
    // App：接管返回键、处理冷启动/热启动传入的文件。
    let disposeIncoming: (() => void) | undefined;
    let disposeSpeechOpen: (() => void) | undefined;
    let cancelled = false;
    const fail = () => {
      if (!cancelled) setError('未能接收系统打开的文件，请从书架重新选择。');
    };
    const progress = (value: NativeImportProgress | undefined) => {
      if (!cancelled) setReceiving(value);
    };
    void nativeApp()
      .then(async (native) => {
        if (cancelled) return;
        void native.cleanupServiceWorkers();
        native.installBackButton();
        if (isAndroidApp) disposeSpeechOpen = native.listenSpeechOpen();
        disposeIncoming = native.listenIncoming(deliver, fail, progress);
        const data = await native.launchIncoming(progress);
        if (data && !cancelled) await deliver(data);
      })
      .catch(fail)
      .finally(() => {
        if (!cancelled) setNativeLaunching(false);
      });
    return () => {
      cancelled = true;
      disposeIncoming?.();
      disposeSpeechOpen?.();
    };
  }, [ready]);
  useEffect(() => {
    let cancelled = false;
    const hash = location.hash;
    if (!isNativeApp) void requestPersistence();
    void restoreOptionalFont();
    void loadStartup(hash, isNativeApp)
      .then((value) => {
        if (cancelled) return;
        settings.value = value.settings;
        setGuide(!value.settings.onboarded);
        if (location.hash === hash) {
          startupBook.current = value.book;
          if (value.hash !== hash) navigate(value.hash, true);
          setError(value.notice);
        }
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setReady(true);
        setError('无法读取启动数据，请检查本地存储。');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    if (route.page === 'reader') {
      setActive(undefined);
      const prepared = startupBook.current;
      startupBook.current = undefined;
      void (
        prepared?.id === route.bookId
          ? Promise.resolve(prepared)
          : getBook(route.bookId)
      )
        .then((book) => {
          if (cancelled) return;
          if (!book || book.missingFile) {
            setError(
              book ? '这本书待补充原文件，请重新导入。' : '这本书已不存在。',
            );
            navigate('#/', true);
            return;
          }
          setActive(book);
          void saveSettings({ lastBookId: book.id })
            .then((value) => {
              settings.value = value;
            })
            .catch(() => setError('无法保存续读设置。'));
        })
        .catch(() => {
          if (!cancelled) {
            setError('无法打开书籍。');
            navigate('#/', true);
          }
        });
    } else {
      setActive(undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [route, ready]);
  useEffect(() => {
    if (route.page !== 'reader' || guide)
      return watchAppearance(globalReading, followSystemTheme);
  }, [globalReading, followSystemTheme, route.page, guide]);
  const receiveLoading = receiving && (
    <BookLoading
      title="正在读取书籍"
      fileName={receiving.fileName}
      detail={`第 ${receiving.index} / ${receiving.total} 本 · 已读取 ${(receiving.bytes / (1024 * 1024)).toFixed(1)} MB`}
    />
  );
  if (!ready || nativeLaunching)
    return (
      <main class="welcome">
        <section class="welcome-body">
          {receiveLoading || (
            <BookLoading title="正在打开静页" detail="留一点时间，给阅读。" />
          )}
        </section>
      </main>
    );
  const content = () => {
    if (guide)
      return (
        <main class="guide-shell">
          <Onboarding first onDone={() => setGuide(false)} />
        </main>
      );
    if (route.page === 'settings')
      return <SettingsPage initialSection={route.section} />;
    if (route.page === 'notes') return <NotesPage />;
    if (route.page === 'about') return <AboutPage />;
    if (route.page === 'paste')
      return (
        <PastePage
          key={route.incomingId ?? route.bookId ?? 'new'}
          bookId={route.bookId}
          incomingId={route.incomingId}
        />
      );
    if (route.page === 'incoming')
      return <IncomingPage key={route.id ?? 'new'} id={route.id} />;
    if (route.page === 'reader' && !active)
      return (
        <main class="welcome">
          <section class="welcome-body">
            <BookLoading title="正在打开书籍" />
          </section>
        </main>
      );
    if (route.page === 'reader' && active)
      return (
        <ReaderView
          key={`${active.id}:${active.contentRevision ?? 0}:${route.noteId ?? ''}`}
          book={active}
          initialHighlightId={route.noteId}
          onBookChanged={(book) => {
            const current = parseRoute(location.hash);
            if (current.page === 'reader' && current.bookId === book.id)
              setActive(book);
          }}
          onBack={() => {
            navigate('#/');
          }}
        />
      );
    return <BookshelfPage notice={error} />;
  };
  return (
    <>
      {content()}
      {receiveLoading && (
        <Modal title="正在读取书籍" onDismiss={() => {}}>
          {receiveLoading}
        </Modal>
      )}
    </>
  );
}
