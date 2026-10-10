import { expect, it } from 'vitest';
import { defaultReading, initialSettings, effectiveReading } from './settings';

it('单本覆盖不改变其他书和全局默认', () => {
  const global = initialSettings();
  const before = structuredClone(global);
  expect(effectiveReading(global.reading, { fontSize: 24 }).fontSize).toBe(24);
  expect(effectiveReading(global.reading).fontSize).toBe(18);
  expect(global).toEqual(before);
  expect(
    effectiveReading(global.reading, { fontSize: undefined }).fontSize,
  ).toBe(18);
});
it('修改全局后的新书继承设置，已有覆盖仍优先且默认模板不变', () => {
  const global = initialSettings();
  global.reading.fontSize = 22;
  expect(effectiveReading(global.reading).fontSize).toBe(22);
  expect(effectiveReading(global.reading, { fontSize: 24 }).fontSize).toBe(24);
  expect(defaultReading.fontSize).toBe(18);
  expect(initialSettings().reading.fontSize).toBe(18);
});
