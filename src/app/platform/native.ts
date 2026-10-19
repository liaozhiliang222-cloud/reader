import { t } from '@/i18n';
import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { navigate, parseRoute, noteLinkRoute } from '@/app/router';
import { isAndroidApp, isIosApp, nativeImmersive } from './index';
import { navDepth, trackNavPop, trackNavPush } from './nav';
import type { IncomingData } from '@/app/incomingData';
import { incomingData, incomingForm, incomingLimit } from '@/app/incomingData';
import type { ScreenLock } from '@/reader/WakeLock';

interface JyNativePlugin {
  setLanguage(options: { language: 'zh-Hans' | 'en' }): Promise<void>;
  pickFiles(): Promise<IncomingPayload>;
  releaseImport(options: { uri: string }): Promise<void>;
  pickSaveTarget(options: {
    name: string;
    mime: string;
  }): Promise<{ uri: string }>;
  writeUri(options: {
    uri: string;
    data: string;
    append?: boolean;
  }): Promise<void>;
  shareChunk(options: {
    name: string;
    data: string;
    append?: boolean;
  }): Promise<void>;
  shareCacheFile(options: { name: string; mime: string }): Promise<void>;
  setImmersive(options: { enabled: boolean }): Promise<void>;
  keepAwake(options: { enabled: boolean }): Promise<void>;
  openUrl(options: { uri: string }): Promise<void>;
  statusBar(options: { color?: string; dark?: boolean }): Promise<void>;
  setVolumeKeys(options: { enabled: boolean }): Promise<void>;
  speechLaunch(): Promise<{ bookId: string | null }>;
  addListener(
    event: 'speechOpen',
    listener: (event: { bookId: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  consumeLaunchFile(): Promise<IncomingPayload>;
  readUriChunk(options: {
    uri: string;
    offset: number;
    length: number;
  }): Promise<{ data: string; eof: boolean }>;
  addListener(
    event: 'incomingFile',
    listener: (payload: IncomingPayload) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'volumeKey',
    listener: (event: { direction: 'prev' | 'next' }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/** Android Intent 解析结果：文件列表（可多个）+ 可选纯文本分享。 */
interface IncomingPayload {
  items?: { uri: string; name: string }[];
  text?: string;
}

export interface NativeImportProgress {
  fileName: string;
  index: number;
  total: number;
  bytes: number;
}
type ImportProgress = (progress: NativeImportProgress | undefined) => void;

const Jy = registerPlugin<JyNativePlugin>('JyNative');
const FileBridge = isIosApp ? registerPlugin<JyNativePlugin>('JyReader') : Jy;
export const setLanguage = (language: 'zh-Hans' | 'en') =>
  isIosApp ? FileBridge.setLanguage({ language }) : Promise.resolve();
export async function pickIncoming() {
  return payloadToIncoming(await FileBridge.pickFiles());
}

export function listenSpeechOpen() {
  let disposed = false;
  let remove: (() => Promise<void>) | undefined;
  const open = async ({ bookId }: { bookId: string | null }) => {
    if (disposed || typeof bookId !== 'string') return;
    const { getBook } = await import('@/db/repository');
    const book = await getBook(bookId);
    if (!disposed && book && !book.missingFile)
      navigate('#/read/' + encodeURIComponent(bookId));
  };
  void Jy.addListener('speechOpen', (event) => {
    void open(event).catch(() => {});
  })
    .then((handle) => {
      if (disposed) void handle.remove();
      else remove = handle.remove;
    })
    .catch(() => {});
  void Jy.speechLaunch()
    .then(open)
    .catch(() => {});
  return () => {
    disposed = true;
    if (remove) void remove();
  };
}

const CHUNK = 512 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error(t('读取数据失败')));
    reader.readAsDataURL(blob);
  });
}

export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (isIosApp) return shareFile(blob, name);
  const { uri } = await Jy.pickSaveTarget({
    name,
    mime: blob.type || 'application/octet-stream',
  });
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const data = await blobToBase64(blob.slice(offset, offset + CHUNK));
    await Jy.writeUri({ uri, data, append: offset > 0 });
  }
}

export async function shareFile(blob: Blob, name: string): Promise<void> {
  const mime = blob.type || 'application/octet-stream';
  if (!blob.size)
    await FileBridge.shareChunk({ name, data: '', append: false });
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const data = await blobToBase64(blob.slice(offset, offset + CHUNK));
    await FileBridge.shareChunk({ name, data, append: offset > 0 });
  }
  await FileBridge.shareCacheFile({ name, mime });
}

// ---- 沉浸模式与常亮 ----

export async function setImmersive(enabled: boolean): Promise<void> {
  await FileBridge.setImmersive({ enabled });
  nativeImmersive.value = enabled;
}
export const keepAwake = (enabled: boolean) =>
  FileBridge.keepAwake({ enabled });

/** 原生 WakeLock 兜底：WebView 的 Wake Lock 已可用，失败时退到窗口常亮标志。 */
export async function nativeScreenLock(): Promise<ScreenLock> {
  await FileBridge.keepAwake({ enabled: true });
  let released = false;
  const listeners = new Set<EventListener>();
  return {
    get released() {
      return released;
    },
    async release() {
      if (released) return;
      released = true;
      await FileBridge.keepAwake({ enabled: false }).catch(() => {});
      for (const listener of [...listeners])
        listener.call(null, new Event('release'));
    },
    addEventListener: (_type, listener) => {
      if (listener) listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      if (listener) listeners.delete(listener);
    },
  };
}

// ---- 状态栏配色 ----

export function syncStatusBar(color: string, dark: boolean): void {
  void FileBridge.statusBar({ color, dark }).catch(() => {});
}

// ---- 返回键 ----

/** 旧版探针包注册过 Service Worker；App 版本升级走 APK，SW 缓存会让新版装旧资源，必须清掉。 */
export async function cleanupServiceWorkers(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((reg) => reg.unregister()));
    const keys = (await caches?.keys()) ?? [];
    await Promise.all(
      keys
        .filter((key) => key.includes('precache') || key.includes('workbox'))
        .map((key) => caches.delete(key)),
    );
  } catch {
    /* 清理失败不影响启动 */
  }
}

let backInstalled = false;

/**
 * 接管系统返回键：有应用内历史就回退（含浮层），在书架且无历史时退出，
 * 冷启动直接停在深层页面时先回书架。
 */
export function installBackButton(): void {
  if (backInstalled) return;
  backInstalled = true;
  if (!isAndroidApp) {
    installLinkRouting();
    const open = (value: string) => {
      const hash = noteLinkRoute(value);
      if (hash) navigate(hash);
    };
    void App.addListener('appUrlOpen', ({ url }) => open(url));
    void App.getLaunchUrl()
      .then((value) => {
        if (value) open(value.url);
      })
      .catch(() => {});
    return;
  }
  const push = history.pushState.bind(history);
  history.pushState = (state, unused, url) => {
    trackNavPush();
    return push(state, unused, url);
  };
  window.addEventListener('popstate', trackNavPop);
  void App.addListener('backButton', (data) => {
    // <dialog> 浮层不占历史层，优先按 Esc 的语义关闭（触发 onCancel → onDismiss）。
    const dialog = document.querySelector('dialog[open]:not([inert])');
    if (dialog) {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      return;
    }
    if (navDepth() > 0 || data.canGoBack) {
      history.back();
      return;
    }
    if (parseRoute(location.hash).page === 'shelf') void App.exitApp();
    else navigate('#/', true);
  });
  installLinkRouting();
}

/**
 * WebView 不支持 target=_blank：站外链接交系统浏览器，站内资源链接改为当前页打开
 * （例如「关于」里的许可文本）。返回键经 canGoBack 兜底可回到应用。
 */
function installLinkRouting(): void {
  document.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement).closest?.('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented)
      return;
    const url = new URL(anchor.href, location.href);
    if (url.origin === location.origin) {
      if (anchor.target === '_blank') {
        event.preventDefault();
        location.href = anchor.href;
      }
      return;
    }
    event.preventDefault();
    void FileBridge.openUrl({ uri: url.href }).catch(() => {});
  });
}

// ---- 外部文件导入 ----

async function readUriFile(
  uri: string,
  name: string,
  limit: number,
  progress: (bytes: number) => void,
): Promise<File> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await FileBridge.readUriChunk({ uri, offset, length: CHUNK });
    // 每块有独立的 Base64 padding，必须分别解码，再组合原始字节。
    const binary = atob(chunk.data);
    if (binary.length > CHUNK || offset + binary.length > limit)
      throw new RangeError(t('文件超过导入大小限制'));
    if (!binary.length && !chunk.eof) throw new Error(t('文件读取未前进'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes);
    offset += bytes.length;
    progress(offset);
    if (chunk.eof) break;
  }
  return new File(parts, name, { type: guessType(name) });
}

function guessType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (lower.endsWith('.md') || lower.endsWith('.markdown'))
    return 'text/markdown';
  return 'text/plain';
}

/** Intent 里的 URI 逐个读成 File；读失败的文件记入 errors，不阻断其余文件。 */
async function payloadToIncoming(
  payload: IncomingPayload,
  progress?: ImportProgress,
): Promise<IncomingData | undefined> {
  const files: File[] = [];
  const errors: string[] = [];
  const text = payload.text?.trim() ?? '';
  let used = new Blob([text]).size;
  if (used > 50 * 1024 * 1024) throw new RangeError(t('分享文字超过 50 MB'));
  const items = payload.items ?? [];
  for (const [index, item] of items.entries()) {
    try {
      const update = (bytes: number) =>
        progress?.({
          fileName: item.name || t('导入文件'),
          index: index + 1,
          total: items.length,
          bytes,
        });
      update(0);
      const file = await readUriFile(
        item.uri,
        item.name || t('导入文件'),
        Math.min(50 * 1024 * 1024, incomingLimit - used),
        update,
      );
      if (isIosApp) await FileBridge.releaseImport({ uri: item.uri });
      files.push(file);
      used += file.size;
    } catch (cause) {
      errors.push(
        t(
          '「{0}」读取失败{1}',
          item.name || t('导入文件'),
          cause instanceof RangeError
            ? t('：文件超过 50 MB 或本次分享超过 100 MB')
            : '',
        ),
      );
    }
  }
  if (!files.length && !text && !errors.length) return undefined;
  return incomingData(incomingForm({ files, title: '', text, errors }));
}

export async function launchIncoming(
  progress?: ImportProgress,
): Promise<IncomingData | undefined> {
  try {
    const pending = await FileBridge.consumeLaunchFile();
    return await payloadToIncoming(pending, progress);
  } finally {
    progress?.(undefined);
  }
}

export function listenIncoming(
  handler: (data: IncomingData) => Promise<void>,
  onError: () => void,
  progress?: ImportProgress,
) {
  let queue = Promise.resolve();
  const sub = FileBridge.addListener('incomingFile', (payload) => {
    queue = queue
      .then(async () =>
        payloadToIncoming(
          isIosApp ? await FileBridge.consumeLaunchFile() : payload,
          progress,
        ),
      )
      .then((data) => (data ? handler(data) : undefined))
      .catch(onError)
      .finally(() => progress?.(undefined));
  });
  return () => {
    void sub.then((listener) => listener.remove());
  };
}

// ---- 音量键翻页 ----

export const setVolumeKeys = (enabled: boolean) =>
  isAndroidApp
    ? Jy.setVolumeKeys({ enabled }).catch(() => {})
    : Promise.resolve();

export function listenVolumeKey(handler: (direction: 'prev' | 'next') => void) {
  if (!isAndroidApp) return () => {};
  const sub = Jy.addListener('volumeKey', (event) => handler(event.direction));
  return () => {
    void sub.then((listener) => listener.remove());
  };
}
