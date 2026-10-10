export function formatDebugValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[无法序列化的对象]';
  }
}

export function appendBounded<T>(
  items: readonly T[],
  item: T,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  return [...items.slice(Math.max(0, items.length - limit + 1)), item];
}
