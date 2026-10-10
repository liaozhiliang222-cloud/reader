let sequence = 0;
const skipMeasure: (report?: boolean) => void = () => {};
/** 仅开发debug入口计时，结束即清理Performance条目，避免长时间阅读积累。 */
export function beginMeasure(
  label: string,
  enabled = import.meta.env.DEV &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('debug') === '1',
) {
  if (!import.meta.env.DEV || !enabled) return skipMeasure;
  const key = `jingye:${sequence++}`;
  const start = `${key}:start`,
    end = `${key}:end`;
  performance.mark(start);
  let finished = false;
  return (report = true) => {
    if (finished) return;
    finished = true;
    performance.mark(end);
    const measure = performance.measure(key, start, end);
    if (report)
      console.info(`性能 · ${label} · ${measure.duration.toFixed(1)} ms`);
    performance.clearMarks(start);
    performance.clearMarks(end);
    performance.clearMeasures(key);
  };
}
