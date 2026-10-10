// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { requestPersistence, storageInfo } from './storage';
afterEach(() => vi.unstubAllGlobals());
it('持久化申请处理批准、拒绝和不支持，不把未知用量显示成零', async () => {
  vi.stubGlobal('navigator', {});
  expect(await requestPersistence()).toBeUndefined();
  expect(await storageInfo()).toEqual({
    usage: undefined,
    quota: undefined,
    persisted: undefined,
  });
  const persist = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('navigator', {
    storage: {
      persist,
      persisted: async () => true,
      estimate: async () => ({ usage: 1024, quota: 2048 }),
    },
  });
  expect(await requestPersistence()).toBe(true);
  expect(await storageInfo()).toEqual({
    usage: 1024,
    quota: 2048,
    persisted: true,
  });
  persist.mockResolvedValue(false);
  expect(await requestPersistence()).toBe(false);
  persist.mockRejectedValue(new Error('blocked'));
  expect(await requestPersistence()).toBeUndefined();
});
