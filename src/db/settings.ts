import { db } from './index';
import type { AppSettings, ReadingSettings } from '@/types';
import { initialSettings } from '@/app/settings';
import { themePatch } from '@/app/themePreference';

export async function loadSettings(): Promise<AppSettings> {
  const value = (await db.settings.get('global'))?.value;
  const defaults = initialSettings();
  return {
    ...defaults,
    ...value,
    reading: { ...defaults.reading, ...value?.reading },
  };
}
export async function saveSettings(
  patch: Partial<Omit<AppSettings, 'reading'>> & {
    reading?: Partial<ReadingSettings>;
  },
) {
  return db.transaction('rw', db.settings, async () => {
    const current = await loadSettings();
    const value = {
      ...current,
      ...patch,
      reading: {
        ...current.reading,
        ...themePatch(patch.reading ?? {}, current.reading),
      },
    };
    await db.settings.put({ id: 'global', value });
    return value;
  });
}
export async function saveBookSettings(
  id: string,
  patch: Partial<ReadingSettings>,
) {
  await db.transaction('rw', db.books, db.settings, async () => {
    const book = await db.books.get(id);
    if (!book) throw new Error('书籍不存在，无法保存排版。');
    const current =
      patch.theme === 'night'
        ? { ...(await loadSettings()).reading, ...book.settingsOverride }
        : book.settingsOverride;
    await db.books.update(id, {
      settingsOverride: {
        ...book.settingsOverride,
        ...themePatch(patch, current),
      },
    });
  });
}
