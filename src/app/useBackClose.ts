import { useEffect, useRef } from 'preact/hooks';

type OverlayState = { jingyeOverlay?: string } | null;

/**
 * 浮层打开时压入一条同址历史记录，让 Android 返回键或 iOS 侧滑先关闭最上层浮层，
 * 而不是直接离开当前页面。界面内关闭时自动回退这条记录。
 */
export function useBackClose(open: boolean, closeTop: () => void) {
  const token = useRef(crypto.randomUUID()).current;
  const pushed = useRef(false),
    leaving = useRef(false),
    ignore = useRef(0),
    after = useRef<(() => void) | undefined>(undefined),
    closeRef = useRef(closeTop);
  closeRef.current = closeTop;
  const own = () => (history.state as OverlayState)?.jingyeOverlay === token;
  useEffect(() => {
    if (leaving.current) return;
    if (open && !pushed.current) {
      history.pushState({ jingyeOverlay: token } satisfies OverlayState, '');
      pushed.current = true;
    } else if (!open && pushed.current) {
      pushed.current = false;
      if (own()) {
        ignore.current++;
        history.back();
      }
    }
  });
  useEffect(() => {
    const pop = () => {
      if (ignore.current) {
        ignore.current--;
        const next = after.current;
        after.current = undefined;
        next?.();
        return;
      }
      if (!pushed.current || own()) return;
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      if (pushed.current && own()) history.back();
    };
  }, []);
  /** 离开页面前先撤掉浮层记录，避免返回时回到已关闭的浮层。 */
  return (action: () => void) => {
    if (!pushed.current || !own()) {
      action();
      return;
    }
    leaving.current = true;
    pushed.current = false;
    ignore.current++;
    after.current = action;
    history.back();
  };
}
