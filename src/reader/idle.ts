/** 可取消的低优先级任务；没有idle API的浏览器仍逐块让出事件循环。 */
export function onIdle(work: () => void) {
  if (
    typeof window.requestIdleCallback === 'function' &&
    typeof window.cancelIdleCallback === 'function'
  ) {
    const id = window.requestIdleCallback(work, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(work, 120);
  return () => clearTimeout(id);
}
