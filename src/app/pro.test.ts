import { expect, it } from 'vitest';
import { readProState, PRO_PRODUCT_ID } from './pro';
const base = {
  protocolVersion: 1,
  productId: PRO_PRODUCT_ID,
  status: 'owned',
  isPro: true,
  message: '',
  price: '¥28',
};
it('只接受符合协议的已验证原生权益，不把等待/错误状态当成购买', () => {
  expect(readProState(base).isPro).toBe(true);
  for (const patch of [
    { status: 'pending' },
    { protocolVersion: 2 },
    { productId: 'other' },
    { isPro: 'true' },
    { status: 'unverified' },
  ])
    expect(() => readProState({ ...base, ...patch })).toThrow();
  expect(readProState({ ...base, status: 'pending', isPro: false }).isPro).toBe(
    false,
  );
});
