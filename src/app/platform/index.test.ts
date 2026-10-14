import { expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false, name: 'web' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.name,
  },
}));

it.each([
  ['web', false, false],
  ['android', true, true],
  ['ios', true, false],
] as const)('听书平台限制：%s', async (name, native, android) => {
  platform.name = name;
  platform.native = native;
  vi.resetModules();
  const current = await import('./index');
  expect(current.isNativeApp).toBe(native);
  expect(current.isAndroidApp).toBe(android);
  expect(current.isIosApp).toBe(native && name === 'ios');
  expect(current.hasNativeSpeech).toBe(
    native && (name === 'ios' || name === 'android'),
  );
  expect(current.platformKind).toBe(name);
});
