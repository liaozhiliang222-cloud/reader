// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { defaultReading } from './defaults';
import { watchAppearance } from './theme';
import { lightTheme, resolveTheme, themePatch } from './themePreference';
import type { ReadingSettings } from '@/types';

class DarkPreference extends EventTarget {
  matches = false;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});
it('跟随系统实时切换正文主题和状态栏颜色，保留浅色选择、字体与纹理，不改偏好', () => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.append(meta);
  const media = new DarkPreference();
  const reading: ReadingSettings = {
    ...defaultReading,
    theme: 'green',
    fontFamily: 'sans',
    texture: true,
  };
  const original = { ...reading };
  const dispose = watchAppearance(reading, true, media);
  expect(document.documentElement.dataset.theme).toBe('green');
  expect(meta.content).toBe('#DCE8D6');
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(document.documentElement.dataset.theme).toBe('night');
  expect(meta.content).toBe('#141414');
  expect(document.documentElement.dataset.font).toBe('sans');
  expect(document.documentElement.dataset.texture).toBe('true');
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  expect(document.documentElement.dataset.theme).toBe('green');
  expect(reading).toEqual(original);
  dispose();
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(document.documentElement.dataset.theme).toBe('green');
});
it('停止跟随与切换书籍时移除旧监听，新主题不会被旧页面写回', () => {
  const media = new DarkPreference();
  const dispose = watchAppearance(
    { ...defaultReading, theme: 'eink' },
    true,
    media,
  );
  dispose();
  const stop = watchAppearance(
    { ...defaultReading, theme: 'paper' },
    false,
    media,
  );
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(document.documentElement.dataset.theme).toBe('paper');
  stop();
});
it('手动夜读后仍记住所选浅色，旧设置无浅色历史时回退米白；无 API 可以使用', () => {
  const reading: ReadingSettings = {
    ...defaultReading,
    theme: 'night',
    lightTheme: 'eink',
  };
  expect(lightTheme(reading)).toBe('eink');
  expect(resolveTheme(reading, true, false)).toBe('eink');
  expect(resolveTheme(reading, true, true)).toBe('night');
  expect(resolveTheme(reading, false, false)).toBe('night');
  expect(resolveTheme({ ...defaultReading, theme: 'night' }, true, false)).toBe(
    'paper',
  );
  expect(themePatch({ theme: 'green' })).toEqual({
    theme: 'green',
    lightTheme: 'green',
  });
  vi.stubGlobal('matchMedia', undefined);
  const stop = watchAppearance(reading, true);
  expect(document.documentElement.dataset.theme).toBe('eink');
  stop();
});
