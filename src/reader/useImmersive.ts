import { useEffect, useRef, useState } from 'preact/hooks';
import { ReaderWakeLock } from './WakeLock';
import type { ReadingSettings } from '@/types';
export function useImmersive(mode: ReadingSettings['wakeLock']) {
  const [wakeStatus, setWakeStatus] = useState('');
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const controller = useRef<ReaderWakeLock | undefined>(undefined);
  useEffect(() => {
    const lock = new ReaderWakeLock(
      () =>
        navigator.wakeLock?.request('screen') ??
        Promise.reject(new Error('Unsupported')),
      (status) =>
        setWakeStatus(
          {
            off: '',
            active: '屏幕常亮中',
            idle: '五分钟未操作，已恢复自动熄屏',
            released: '常亮已由系统释放',
            unavailable: '当前浏览器或系统未允许常亮',
          }[status],
        ),
    );
    controller.current = lock;
    lock.setVisible(document.visibilityState === 'visible');
    const visibility = () =>
      lock.setVisible(document.visibilityState === 'visible');
    const activity = () => lock.activity();
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('pointerdown', activity);
    document.addEventListener('keydown', activity);
    document.addEventListener('fullscreenchange', change);
    // A transition started on the bookshelf can finish before this effect.
    // Subscribe first, then read the current native state so neither is missed.
    change();
    return () => {
      lock.dispose();
      controller.current = undefined;
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerdown', activity);
      document.removeEventListener('keydown', activity);
      document.removeEventListener('fullscreenchange', change);
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => controller.current?.setMode(mode), [mode]);
  return { wakeStatus, fullscreen };
}
export async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (
    !document.fullscreenEnabled ||
    !document.documentElement.requestFullscreen
  )
    throw new Error('当前浏览器不支持全屏，可添加到主屏幕阅读。');
  await document.documentElement.requestFullscreen();
}
export function tryReaderFullscreen() {
  if (
    /Android/i.test(navigator.userAgent) &&
    navigator.userActivation?.isActive &&
    document.fullscreenEnabled &&
    !document.fullscreenElement
  )
    void document.documentElement.requestFullscreen().catch(() => {});
}
