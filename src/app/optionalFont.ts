import { signal } from '@preact/signals';
import { file, size, sha256 } from './fontAsset.json';

export const fontState = signal<{
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'unavailable';
  error?: string;
}>({ phase: 'idle' });
export const optionalFontSize = size;
let face: FontFace | undefined;
let restoring: Promise<void> | undefined;
let downloading: Promise<void> | undefined;
const url = () => new URL(import.meta.env.BASE_URL + file, location.origin);
const cacheName = () =>
  'jingye-font-' + new URL(import.meta.env.BASE_URL, location.origin).pathname;
const available = () =>
  typeof caches !== 'undefined' &&
  typeof FontFace !== 'undefined' &&
  !!crypto.subtle;

async function verified(response: Response) {
  if (!response.ok || response.type === 'opaque')
    throw new Error('字体下载失败，请联网后重试。');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== size)
    throw new Error('字体文件大小不正确，请重新下载。');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== sha256) throw new Error('字体文件校验失败，请重新下载。');
  return bytes;
}
async function load(bytes: ArrayBuffer) {
  const next = await new FontFace('JingyeWenkai', bytes, {
    weight: '400',
    style: 'normal',
  }).load();
  if (face) document.fonts.delete(face);
  face = next;
  document.fonts.add(next);
}
export function restoreOptionalFont() {
  if (restoring) return restoring;
  restoring = (async () => {
    if (!available()) {
      fontState.value = { phase: 'unavailable' };
      return;
    }
    fontState.value = { phase: 'checking' };
    try {
      const cache = await caches.open(cacheName());
      const saved = await cache.match(url().href);
      if (saved) {
        await load(await verified(saved));
        fontState.value = { phase: 'ready' };
      } else fontState.value = { phase: 'idle' };
    } catch {
      fontState.value = {
        phase: 'idle',
        error: '本机字体缓存不可用，可以重新下载；当前使用系统字体。',
      };
    }
  })();
  return restoring;
}
export function downloadOptionalFont() {
  if (downloading) return downloading;
  downloading = (async () => {
    await restoreOptionalFont();
    if (!available()) {
      fontState.value = { phase: 'unavailable' };
      return;
    }
    if (fontState.value.phase === 'ready') return;
    fontState.value = { phase: 'downloading' };
    try {
      // No URL-backed @font-face: only this explicit user action can fetch.
      const response = await fetch(url(), {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
      const bytes = await verified(response.clone());
      // Load before caching so unsupported/corrupt fonts are never marked ready.
      await load(bytes);
      try {
        await (await caches.open(cacheName())).put(url().href, response);
        fontState.value = { phase: 'ready' };
      } catch {
        if (face) document.fonts.delete(face);
        face = undefined;
        throw new Error('字体未能保存到本机，请检查存储空间后重试。');
      }
    } catch (cause) {
      fontState.value = {
        phase: 'idle',
        error:
          cause instanceof Error ? cause.message : '字体下载失败，请重试。',
      };
    }
  })().finally(() => {
    downloading = undefined;
  });
  return downloading;
}
export async function removeOptionalFont() {
  await restoring;
  if (downloading) return;
  try {
    if (typeof caches !== 'undefined') await caches.delete(cacheName());
    if (face) document.fonts.delete(face);
    face = undefined;
    restoring = undefined;
    fontState.value = { phase: 'idle' };
  } catch {
    fontState.value = {
      ...fontState.value,
      error: '字体缓存未能删除，请重试。',
    };
  }
}
