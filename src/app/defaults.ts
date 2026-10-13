import type { AppSettings, ReadingSettings } from '@/types';
export const defaultReading: Readonly<ReadingSettings> = Object.freeze({
  fontSize: 18,
  lineHeight: 1.8,
  paragraphSpacing: 0.5,
  margin: 'medium',
  indent: true,
  fontFamily: 'serif',
  align: 'justify',
  theme: 'paper',
  texture: false,
  pageAnimation: 'slide',
  tapMode: 'normal',
  showHeaderFooter: true,
  wakeLock: 'off',
  quietHint: true,
  volumeKeys: false,
});
export function initialSettings(): AppSettings {
  return {
    shelfSort: 'recent',
    reading: { ...defaultReading },
    autoResume: false,
    followSystemTheme: false,
    checkUpdates: true,
    onboarded: false,
    speech: { rate: 1, timer: 'off' },
  };
}
