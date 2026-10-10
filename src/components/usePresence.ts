import { useEffect, useMemo, useState } from 'preact/hooks';
import { listenMedia, mediaState } from '@/app/media';

export function useReducedMotion() {
  const media = useMemo(
    () => mediaState('(prefers-reduced-motion: reduce)'),
    [],
  );
  const [reduced, setReduced] = useState(media.matches);
  useEffect(() => listenMedia(media, () => setReduced(media.matches)), [media]);
  return reduced;
}
export function usePresence(open: boolean, duration: number, reduced: boolean) {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (reduced) {
      setRetained(false);
      return;
    }
    if (!retained) return;
    const timer = window.setTimeout(() => setRetained(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, reduced, retained]);
  return open || (retained && !reduced);
}
