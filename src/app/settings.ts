import { signal } from '@preact/signals';
import type { AppSettings, ReadingSettings } from '@/types';

import { defaultReading, initialSettings } from './defaults';
export { defaultReading, initialSettings };
export const settings = signal<AppSettings>(initialSettings());
export function effectiveReading(
  global: ReadingSettings,
  override?: Partial<ReadingSettings>,
): ReadingSettings {
  // undefined 覆盖值不应清除默认值。
  const defined = Object.fromEntries(
    Object.entries(override ?? {}).filter(([, value]) => value !== undefined),
  );
  return { ...defaultReading, ...global, ...defined };
}
