import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { navigate, parseRoute } from '@/app/router';
import { nativeImmersive } from './index';
import { navDepth, trackNavPop, trackNavPush } from './nav';
import type { IncomingData } from '@/app/incomingData';
import { incomingData, incomingForm, incomingLimit } from '@/app/incomingData';
import type { ScreenLock } from '@/reader/WakeLock';

interface JyNativePlugin {
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

/** JyNative 只有 Android 实现；iOS 一律走官方 Capacitor 插件或安全降级。 */
const isAndroid = Capacitor.getPlatform() === 'android';

const CHUNK = 512 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取数据失败'));
    reader.readAsDataURL(blob);
  });
}

/** iOS 没有 SAF，导出/分享统一走系统分享表单（可选「存储到文件」）。 */
async function systemShareFile(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, {
    type: blob.type || 'application/octet-stream',
  });
  if (!navigator.canShare?.({ files: [file] }))
    throw new Error('当前系统不支持分享文件。');
  await navigator.share({ files: [file], title: name });
}

export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (!isAndroid) return systemShareFile(blob, name);
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
  if (!isAndroid) return systemShareFile(blob, name);
  const mime = blob.type || 'application/octet-stream';
  if (!blob.size) await Jy.shareChunk({ name, data: '', append: false });
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const data = await blobToBase64(blob.slice(offset, offset + CHUNK));
    await Jy.shareChunk({ name, data, append: offset > 0 });
  }
  await Jy.shareCacheFile({ name, mime });
}

// ---- 沉浸模式与常亮 ----

export async function setImmersive(enabled: boolean): Promise<void> {
  if (isAndroid) await Jy.setImmersive({ enabled });
  else if (enabled) await StatusBar.hide();
  else await StatusBar.show();
  nativeImmersive.value = enabled;
}
export const keepAwake = (enabled: boolean) =>
  isAndroid ? Jy.keepAwake({ enabled }) : Promise.resolve();

/** 原生 WakeLock 兜底：WebView 的 Wake Lock 已可用，失败时退到窗口常亮标志。 */
export async function nativeScreenLock(): Promise<ScreenLock> {
  // iOS 无窗口常亮 API；Web WakeLock 失败时如实报不可用。
  if (!isAndroid) throw new Error('Unsupported');
  await Jy.keepAwake({ enabled: true });
  let released = false;
  const listeners = new Set<EventListener>();
  return {
    get released() {
      return released;
    },
    async release() {
      if (released) return;
      released = true;
      await Jy.keepAwake({ enabled: false }).catch(() => {});
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
  if (isAndroid) {
    void Jy.statusBar({ color, dark }).catch(() => {});
    return;
  }
  void StatusBar.setStyle({
    style: dark ? Style.Light : Style.Dark,
  }).catch(() => {});
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
    if (isAndroid) void Jy.openUrl({ uri: url.href }).catch(() => {});
    else window.open(url.href, '_blank');
  });
}

// ---- 外部文件导入 ----

function fileNameFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname)
      .split('/')
      .filter(Boolean)
      .pop();
    return name || '导入文件';
  } catch {
    return '导入文件';
  }
}

/** iOS「打开方式」送来 file:// URL，经 convertFileSrc 交由 WKWebView 读取。 */
async function readIosFile(
  uri: string,
  name: string,
  limit: number,
  progress: (bytes: number) => void,
): Promise<File> {
  const response = await fetch(Capacitor.convertFileSrc(uri));
  if (!response.ok || !response.body) throw new Error('无法读取文件');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const reader = response.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > limit)
      throw new RangeError('文件超过导入大小限制');
    parts.push(value);
    total += value.length;
    progress(total);
  }
  return new File(parts, name, { type: guessType(name) });
}

async function readUriFile(
  uri: string,
  name: string,
  limit: number,
  progress: (bytes: number) => void,
): Promise<File> {
  if (!isAndroid) return readIosFile(uri, name, limit, progress);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await Jy.readUriChunk({ uri, offset, length: CHUNK });
    // 每块有独立的 Base64 padding，必须分别解码，再组合原始字节。
    const binary = atob(chunk.data);
    if (binary.length > CHUNK || offset + binary.length > limit)
      throw new RangeError('文件超过导入大小限制');
    if (!binary.length && !chunk.eof) throw new Error('文件读取未前进');
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
  if (used > 50 * 1024 * 1024) throw new RangeError('分享文字超过 50 MB');
  const items = payload.items ?? [];
  for (const [index, item] of items.entries()) {
    try {
      const update = (bytes: number) =>
        progress?.({
          fileName: item.name || '导入文件',
          index: index + 1,
          total: items.length,
          bytes,
        });
      update(0);
      const file = await readUriFile(
        item.uri,
        item.name || '导入文件',
        Math.min(50 * 1024 * 1024, incomingLimit - used),
        update,
      );
      files.push(file);
      used += file.size;
    } catch (cause) {
      errors.push(
        `「${item.name || '导入文件'}」读取失败${cause instanceof RangeError ? '：文件超过 50 MB 或本次分享超过 100 MB' : ''}`,
      );
    }
  }
  if (!files.length && !text && !errors.length) return undefined;
  return incomingData(incomingForm({ files, title: '', text, errors }));
}

// iOS 冷启动的 getLaunchUrl 与热启动的 appUrlOpen 可能送达同一 URL，10 秒内去重。
const handledUrls = new Map<string, number>();
function markHandled(url: string): boolean {
  const now = Date.now();
  for (const [key, at] of handledUrls)
    if (now - at > 10_000) handledUrls.delete(key);
  if (handledUrls.has(url)) return false;
  handledUrls.set(url, now);
  return true;
}

/** iOS 冷启动经「打开方式」进入时，文件 URL 由 getLaunchUrl 返回。 */
async function iosLaunchPayload(): Promise<IncomingPayload> {
  const launch = await App.getLaunchUrl().catch(() => undefined);
  const url = launch?.url ?? '';
  if (!url.startsWith('file:') || !markHandled(url)) return {};
  return { items: [{ uri: url, name: fileNameFromUrl(url) }] };
}

export async function launchIncoming(
  progress?: ImportProgress,
): Promise<IncomingData | undefined> {
  try {
    const pending = isAndroid
      ? await Jy.consumeLaunchFile()
      : await iosLaunchPayload();
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
  const deliver = (payload: IncomingPayload) => {
    queue = queue
      .then(() => payloadToIncoming(payload, progress))
      .then((data) => (data ? handler(data) : undefined))
      .catch(onError)
      .finally(() => progress?.(undefined));
  };
  const sub = isAndroid
    ? Jy.addListener('incomingFile', deliver)
    : App.addListener('appUrlOpen', (event) => {
        if (event.url.startsWith('file:') && markHandled(event.url))
          deliver({
            items: [{ uri: event.url, name: fileNameFromUrl(event.url) }],
          });
      });
  return () => {
    void sub.then((listener) => listener.remove());
  };
}

// ---- 音量键翻页 ----

export const setVolumeKeys = (enabled: boolean) =>
  isAndroid ? Jy.setVolumeKeys({ enabled }).catch(() => {}) : Promise.resolve();

export function listenVolumeKey(handler: (direction: 'prev' | 'next') => void) {
  // iOS 没有音量键接管 API，返回空实现。
  const sub = isAndroid
    ? Jy.addListener('volumeKey', (event) => handler(event.direction))
    : Promise.resolve({ remove: () => Promise.resolve() });
  return () => {
    void sub.then((listener) => listener.remove());
  };
}
