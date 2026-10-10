import { useEffect, useState } from 'preact/hooks';
import { trackNavPush } from './platform/nav';

export type Route =
  | { page: 'shelf' }
  | { page: 'about' }
  | { page: 'settings'; section?: 'backup' }
  | { page: 'paste'; bookId?: string; incomingId?: string }
  | { page: 'incoming'; id?: string }
  | { page: 'reader'; bookId: string };
export function parseRoute(hash: string): Route {
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
      const bookId = decodeURIComponent(hash.slice(paste ? 8 : 7));
      if (bookId) return { page: paste ? 'paste' : 'reader', bookId };
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
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const change = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}
