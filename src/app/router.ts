import { useEffect, useState } from 'preact/hooks';
import { trackNavPush } from './platform/nav';

export type Route =
  | { page: 'shelf' }
  | { page: 'about' }
  | { page: 'notes' }
  | { page: 'settings'; section?: 'backup' }
  | { page: 'paste'; bookId?: string; incomingId?: string }
  | { page: 'incoming'; id?: string }
  | { page: 'reader'; bookId: string; noteId?: string };
export function parseRoute(hash: string): Route {
  if (hash === '#/notes') return { page: 'notes' };
  if (hash === '#/about') return { page: 'about' };
  if (hash === '#/incoming') return { page: 'incoming' };
  if (hash.startsWith('#/incoming/'))
    return { page: 'incoming', id: hash.slice(11) };
  if (hash.startsWith('#/paste-share/'))
    return { page: 'paste', incomingId: hash.slice(14) };
  if (hash === '#/settings') return { page: 'settings' };
  if (hash === '#/settings/backup')
    return { page: 'settings', section: 'backup' };
  if (hash === '#/paste') return { page: 'paste' };
  if (hash.startsWith('#/read/') || hash.startsWith('#/paste/')) {
    try {
      const paste = hash.startsWith('#/paste/');
      const [encoded, query] = hash.slice(paste ? 8 : 7).split('?');
      const bookId = decodeURIComponent(encoded ?? '');
      const noteId = new URLSearchParams(query).get('note') ?? undefined;
      if (bookId)
        return paste
          ? { page: 'paste', bookId }
          : { page: 'reader', bookId, ...(noteId ? { noteId } : {}) };
    } catch {
      /* 无效路由返回书架 */
    }
  }
  return { page: 'shelf' };
}
export function navigate(hash: string, replace = false) {
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    if (location.hash === hash) return;
    trackNavPush();
    location.hash = hash;
  }
}
export function noteLinkRoute(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'jingye:' || url.hostname !== 'note') return;
    const parts = url.pathname.slice(1).split('/');
    if (parts.length !== 2 || !parts.every(Boolean)) return;
    const book = decodeURIComponent(parts[0]!),
      note = decodeURIComponent(parts[1]!);
    return `#/read/${encodeURIComponent(book)}?note=${encodeURIComponent(note)}`;
  } catch {
    return;
  }
}
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const change = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}
