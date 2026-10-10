export function gestureAction(
  dx: number,
  dy: number,
  duration: number,
  fraction: number,
  mode: 'normal' | 'oneHand' = 'normal',
  previousCorner = false,
): 'next' | 'previous' | 'menu' | null {
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 15) return null;
  // 跟手拖过阈值即翻页，不限时长；时长上限只用于区分点按与长按。
  if (
    Math.abs(dx) > 40 ||
    (duration <= 500 &&
      Math.abs(dx) > 10 &&
      Math.abs(dx) / Math.max(1, duration) > 0.3)
  )
    return dx < 0 ? 'next' : 'previous';
  if (duration > 500 || Math.abs(dx) > 10 || Math.abs(dy) > 10) return null;
  if (mode === 'oneHand' && previousCorner) return 'previous';
  return fraction < 1 / 3
    ? mode === 'oneHand'
      ? 'next'
      : 'previous'
    : fraction > 2 / 3
      ? 'next'
      : 'menu';
}
