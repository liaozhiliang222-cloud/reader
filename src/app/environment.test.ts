import { expect, it } from 'vitest';
import { detectEnvironment } from './environment';

it.each([
  ['iPhone OS 16_3 like Mac OS X MicroMessenger/8.0', 0, true, true, '微信'],
  ['iPad; CPU OS 16_4 like Mac OS X', 5, true, false, undefined],
  ['iPhone OS 17_0 like Mac OS X QQ/9.0.8', 0, true, false, 'QQ'],
  ['Linux; Android 14 MQQBrowser/14.5 QQ/9.0.8', 5, false, false, 'QQ'],
  ['Linux; Android 14 MQQBrowser/14.5', 5, false, false, undefined],
  [
    'Macintosh; Intel Mac OS X 10_15 Version/16.3 Safari/605.1.15',
    5,
    true,
    true,
    undefined,
  ],
  [
    'Macintosh; Intel Mac OS X 10_15 Version/16.3 Safari/605.1.15',
    0,
    false,
    false,
    undefined,
  ],
  ['Windows NT 10.0 Chrome/125.0.0 Safari/537.36', 0, false, false, undefined],
  ['iPhone OS 16_10 like Mac OS X', 0, true, false, undefined],
] as const)(
  '识别平台与版本，不把普通 QQ 浏览器或 Mac 误判为内置浏览器：%s',
  (ua, touch, ios, olderIos, inApp) => {
    expect(detectEnvironment(ua, touch)).toEqual({ ios, olderIos, inApp });
  },
);

it('未知 iOS 版本不会被当作旧版', () => {
  expect(detectEnvironment('iPhone Safari')).toEqual({
    ios: true,
    olderIos: false,
    inApp: undefined,
  });
});
