import type { ReadingSettings } from '@/types';

/** 记住所选浅色；系统切换只决定显示，不写回用户偏好。 */
export function themePatch(
  patch: Partial<ReadingSettings>,
  current?: Partial<ReadingSettings>,
): Partial<ReadingSettings> {
  if (patch.theme === 'night' && patch.lightTheme === undefined && current) {
    const previous =
      current.theme && current.theme !== 'night'
        ? current.theme
        : current.lightTheme;
    if (previous) return { ...patch, lightTheme: previous };
  }
  return patch.theme && patch.theme !== 'night'
    ? { ...patch, lightTheme: patch.theme }
    : patch;
}
export const lightTheme = (reading: ReadingSettings) =>
  reading.theme === 'night' ? (reading.lightTheme ?? 'paper') : reading.theme;
export function resolveTheme(
  reading: ReadingSettings,
  follow: boolean,
  dark: boolean,
) {
  return follow ? (dark ? 'night' : lightTheme(reading)) : reading.theme;
}
