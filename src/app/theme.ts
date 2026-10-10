import type { ReadingSettings } from '@/types';
import { mediaState, listenMedia, type MediaState } from './media';
import { resolveTheme } from './themePreference';
import { isNativeApp, nativeApp } from './platform';
const colors = {
  paper: '#F5F0E6',
  eink: '#EDEDEB',
  green: '#DCE8D6',
  night: '#141414',
};
export function applyAppearance(reading: ReadingSettings) {
  document.documentElement.dataset.theme = reading.theme;
  document.documentElement.dataset.font = reading.fontFamily;
  document.documentElement.dataset.texture = String(reading.texture);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', colors[reading.theme]);
  if (isNativeApp)
    void nativeApp().then((native) =>
      native.syncStatusBar(colors[reading.theme], reading.theme === 'night'),
    );
}
export function watchAppearance(
  reading: ReadingSettings,
  follow: boolean,
  media: MediaState = mediaState('(prefers-color-scheme: dark)'),
) {
  const apply = () =>
    applyAppearance({
      ...reading,
      theme: resolveTheme(reading, follow, media.matches),
    });
  apply();
  return follow ? listenMedia(media, apply) : () => {};
}
