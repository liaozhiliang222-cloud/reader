import type { Book, Locator, ReadingLocation } from '@/types';
import { validLocator } from '@/reader/speech/protocol';

export const sourceFingerprint = (book: Pick<Book, 'id'>) => {
  const hash = book.id.slice(-64);
  return /^[a-f0-9]{64}$/.test(hash) ? hash : undefined;
};
/** Legacy text positions stay byte-for-byte compatible. Unsupported modes fail explicitly. */
export function textLocation(value: unknown): Locator {
  if (validLocator(value)) return { ...value };
  if (
    value &&
    typeof value === 'object' &&
    Reflect.get(value, 'kind') === 'text'
  ) {
    const locator: unknown = Reflect.get(value, 'locator');
    if (validLocator(locator)) return { ...locator };
  }
  throw new Error('此阅读位置需要更新版本，未修改原始数据。');
}
export const typedLocation = (locator: Locator): ReadingLocation => ({
  kind: 'text',
  locator: textLocation(locator),
});
