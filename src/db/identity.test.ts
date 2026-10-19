import { expect, it } from 'vitest';
import { sourceFingerprint, textLocation, typedLocation } from './identity';
it('旧 UTF-16 锚点保持原值，模式标记不混用 PDF 页码', () => {
  const locator = { chapterIndex: 2, paragraphIndex: 3, charOffset: 17 };
  expect(textLocation(locator)).toEqual(locator);
  expect(textLocation(typedLocation(locator))).toEqual(locator);
  expect(() => textLocation({ kind: 'pdf', pageIndex: 2 })).toThrow('更新版本');
  expect(() => textLocation({ ...locator, charOffset: -1 })).toThrow();
  expect(sourceFingerprint({ id: 'md:' + 'a'.repeat(64) })).toBe(
    'a'.repeat(64),
  );
});
