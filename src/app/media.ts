export type MediaState = Pick<MediaQueryList, 'matches'> &
  Partial<
    Pick<
      MediaQueryList,
      | 'addEventListener'
      | 'removeEventListener'
      | 'addListener'
      | 'removeListener'
    >
  >;
export function mediaState(query: string): MediaState {
  return window.matchMedia?.(query) ?? { matches: false };
}
export function listenMedia(media: MediaState, change: () => void) {
  if (media.addEventListener) {
    media.addEventListener('change', change);
    return () => media.removeEventListener?.('change', change);
  }
  media.addListener?.(change);
  return () => media.removeListener?.(change);
}
