export function visibleRange(
  count: number,
  scroll: number,
  height: number,
  row = 56,
  overscan = 4,
) {
  const start = Math.max(
    0,
    Math.min(count, Math.floor(Math.max(0, scroll) / row) - overscan),
  );
  const end = Math.min(
    count,
    Math.max(
      start,
      Math.ceil((Math.max(0, scroll) + Math.max(0, height)) / row) + overscan,
    ),
  );
  return { start, end };
}
