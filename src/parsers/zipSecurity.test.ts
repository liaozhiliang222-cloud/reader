import JSZip from 'jszip';
import { deflateRawSync, crc32 } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { BoundedZip, type ZipLimits } from './zip';

const limits: ZipLimits = {
  input: 1024 * 1024,
  entries: 10,
  entry: 100000,
  total: 200000,
};
async function normal(files: Record<string, string>, streamFiles = false) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    streamFiles,
  });
}
function directory(buffer: ArrayBuffer) {
  const view = new DataView(buffer),
    end = buffer.byteLength - 22;
  let at = view.getUint32(end + 16, true);
  const entries: number[] = [];
  while (at < end) {
    entries.push(at);
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return { view, entries, end };
}
// Independently encoded ZIP records, including formats JSZip does not generate.
function single(
  content: string,
  options: {
    wide?: boolean;
    descriptor?: boolean;
    unicode?: string;
    rawName?: Uint8Array;
    body?: Uint8Array;
  } = {},
) {
  const rawName = options.rawName ?? new TextEncoder().encode('a');
  const plain = new TextEncoder().encode(content),
    body = options.body ?? deflateRawSync(plain);
  const crc = crc32(plain),
    wide = options.wide ?? false;
  const unicode =
    options.unicode === undefined
      ? undefined
      : new TextEncoder().encode(options.unicode);
  const extra = new DataView(
    new ArrayBuffer((wide ? 28 : 0) + (unicode ? 9 + unicode.length : 0)),
  );
  if (wide) {
    extra.setUint16(0, 1, true);
    extra.setUint16(2, 24, true);
    extra.setBigUint64(4, BigInt(plain.length), true);
    extra.setBigUint64(12, BigInt(body.length), true);
    extra.setBigUint64(20, 0n, true);
  }
  if (unicode) {
    const at = wide ? 28 : 0;
    extra.setUint16(at, 0x7075, true);
    extra.setUint16(at + 2, 5 + unicode.length, true);
    extra.setUint8(at + 4, 1);
    extra.setUint32(at + 5, crc32(rawName), true);
    new Uint8Array(extra.buffer, at + 9).set(unicode);
  }
  const local = new DataView(new ArrayBuffer(30)),
    central = new DataView(new ArrayBuffer(46)),
    end = new DataView(new ArrayBuffer(22));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, options.descriptor ? 8 : 0, true);
  local.setUint16(8, 8, true);
  local.setUint32(14, options.descriptor ? 0 : crc, true);
  local.setUint32(18, options.descriptor ? 0 : body.length, true);
  local.setUint32(22, options.descriptor ? 0 : plain.length, true);
  local.setUint16(26, rawName.length, true);
  const descriptor = new DataView(
    new ArrayBuffer(options.descriptor ? (wide ? 24 : 16) : 0),
  );
  if (options.descriptor) {
    descriptor.setUint32(0, 0x08074b50, true);
    descriptor.setUint32(4, crc, true);
    if (wide) {
      descriptor.setBigUint64(8, BigInt(body.length), true);
      descriptor.setBigUint64(16, BigInt(plain.length), true);
    } else {
      descriptor.setUint32(8, body.length, true);
      descriptor.setUint32(12, plain.length, true);
    }
  }
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, wide ? 45 : 20, true);
  central.setUint16(6, wide ? 45 : 20, true);
  central.setUint16(8, options.descriptor ? 8 : 0, true);
  central.setUint16(10, 8, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, wide ? 0xffffffff : body.length, true);
  central.setUint32(24, wide ? 0xffffffff : plain.length, true);
  central.setUint16(28, rawName.length, true);
  central.setUint16(30, extra.byteLength, true);
  central.setUint32(42, wide ? 0xffffffff : 0, true);
  const centralAt = 30 + rawName.length + body.length + descriptor.byteLength,
    centralSize = 46 + rawName.length + extra.byteLength;
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, wide ? 0xffff : 1, true);
  end.setUint16(10, wide ? 0xffff : 1, true);
  end.setUint32(12, wide ? 0xffffffff : centralSize, true);
  end.setUint32(16, wide ? 0xffffffff : centralAt, true);
  const zip64 = new DataView(new ArrayBuffer(wide ? 56 : 0)),
    locator = new DataView(new ArrayBuffer(wide ? 20 : 0));
  if (wide) {
    zip64.setUint32(0, 0x06064b50, true);
    zip64.setBigUint64(4, 44n, true);
    zip64.setUint16(12, 45, true);
    zip64.setUint16(14, 45, true);
    zip64.setBigUint64(24, 1n, true);
    zip64.setBigUint64(32, 1n, true);
    zip64.setBigUint64(40, BigInt(centralSize), true);
    zip64.setBigUint64(48, BigInt(centralAt), true);
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(centralAt + centralSize), true);
    locator.setUint32(16, 1, true);
  }
  return new Blob([
    local.buffer,
    Uint8Array.from(rawName).buffer,
    Uint8Array.from(body).buffer,
    descriptor.buffer,
    central.buffer,
    Uint8Array.from(rawName).buffer,
    extra.buffer,
    zip64.buffer,
    locator.buffer,
    end.buffer,
  ]).arrayBuffer();
}

it('重复路径在任何解析库覆盖名称前拒绝；声明条目数、目录边界、两份文件名必须一致', async () => {
  const original = await normal({ a: 'safe', b: 'other' });
  const duplicate = original.slice(0),
    { view, entries } = directory(duplicate);
  const second = entries[1]!,
    local = view.getUint32(second + 42, true);
  view.setUint8(second + 46, 97);
  view.setUint8(local + 30, 97);
  await expect(BoundedZip.load(duplicate, limits)).rejects.toThrow('重复');
  for (const change of ['count', 'range', 'name', 'encrypted'] as const) {
    const buffer = original.slice(0),
      { view, entries, end } = directory(buffer);
    if (change === 'count') {
      view.setUint16(end + 8, 1, true);
      view.setUint16(end + 10, 1, true);
    }
    if (change === 'range') view.setUint32(end + 12, 1, true);
    if (change === 'name') view.setUint8(entries[0]! + 46, 99);
    if (change === 'encrypted') view.setUint16(entries[0]! + 8, 1, true);
    await expect(BoundedZip.load(buffer, limits)).rejects.toThrow(/ZIP/);
  }
});
it('即使声明一致，也不能让一份条目的数据覆盖下一份本地头', async () => {
  const buffer = await normal({ a: 'safe', b: 'other' });
  const { view, entries } = directory(buffer),
    first = entries[0]!,
    second = view.getUint32(entries[1]! + 42, true);
  const compressed = second + 10 - 31;
  view.setUint32(18, compressed, true);
  view.setUint32(first + 20, compressed, true);
  await expect(BoundedZip.load(buffer, limits)).rejects.toThrow('重叠');
});
it('空条目的原 CRC 仍校验；伪称空数据不能跳过实际解压；真正空 DEFLATE 可读', async () => {
  const empty = await single(''),
    { view, entries } = directory(empty);
  const valid = await BoundedZip.load(empty, limits);
  expect((await valid.read('a')).size).toBe(0);
  view.setUint32(14, 123, true);
  view.setUint32(entries[0]! + 16, 123, true);
  const wrong = await BoundedZip.load(empty, limits);
  await expect(wrong.read('a')).rejects.toThrow('CRC');
  const fake = await single('x'.repeat(50000)),
    data = directory(fake);
  data.view.setUint32(22, 0, true);
  data.view.setUint32(data.entries[0]! + 24, 0, true);
  data.view.setUint32(14, 0, true);
  data.view.setUint32(data.entries[0]! + 16, 0, true);
  const bomb = await BoundedZip.load(fake, limits);
  await expect(bomb.read('a')).rejects.toThrow('实际解压大小');
});
it('内容与 CRC 即便相同，缺少终止块、末尾多余字节和未使用资源损坏仍拒绝', async () => {
  // A non-final stored deflate block contains all text but has no final block.
  const block = Uint8Array.of(0, 1, 0, 254, 255, 97);
  const truncated = await BoundedZip.load(
    await single('a', { body: block }),
    limits,
  );
  await expect(truncated.read('a')).rejects.toThrow('截断');
  const trailing = await BoundedZip.load(
    await single('a', {
      body: Uint8Array.from([...deflateRawSync('a'), 0, 0]),
    }),
    limits,
  );
  await expect(trailing.verifyRemaining()).rejects.toThrow('多余数据');
});
it('标准/ZIP64流描述符及 Unicode 路径可读；64位大数、路径穿越和假描述符拒绝', async () => {
  for (const wide of [false, true]) {
    for (const descriptor of [false, true]) {
      const zip = await BoundedZip.load(
        await single('123456789', { wide, descriptor, unicode: '书页.txt' }),
        limits,
      );
      expect(await (await zip.read('书页.txt')).text()).toBe('123456789');
    }
  }
  const zip = await BoundedZip.load(
    await single('a', { rawName: Uint8Array.of(0x82), unicode: '文字.txt' }),
    limits,
  );
  expect(await (await zip.read('文字.txt')).text()).toBe('a');
  await expect(
    BoundedZip.load(await single('a', { unicode: '../evil' }), limits),
  ).rejects.toThrow('路径');
  const huge = await single('a', { wide: true });
  const hugeView = new DataView(huge);
  // ZIP64 EOCD sits directly before its locator and ordinary EOCD.
  hugeView.setBigUint64(huge.byteLength - 98 + 32, 2n ** 60n, true);
  await expect(BoundedZip.load(huge, limits)).rejects.toThrow('ZIP');
  const bad = await single('a', { descriptor: true }),
    { view, entries } = directory(bad);
  view.setUint32(entries[0]! - 12, 0, true);
  await expect(BoundedZip.load(bad, limits)).rejects.toThrow('ZIP');
});
it('Blob读取只使用切片，拒绝整体arrayBuffer；实际输入分块不超过64KiB', async () => {
  const file = new File(
    [await normal({ a: '😀'.repeat(10000) }, true)],
    'stream.zip',
  );
  const whole = vi
    .spyOn(file, 'arrayBuffer')
    .mockRejectedValue(new Error('must not buffer entire archive'));
  const zip = await BoundedZip.load(file, limits);
  expect(await (await zip.read('a')).text()).toBe('😀'.repeat(10000));
  expect(whole).not.toHaveBeenCalled();
  expect(() => zip.restrictTotal(1)).toThrow('总大小');
  const bytes = new Uint8Array(200000);
  for (let at = 0; at < bytes.length; at += 65536)
    crypto.getRandomValues(
      bytes.subarray(at, Math.min(at + 65536, bytes.length)),
    );
  for (const compression of ['STORE', 'DEFLATE'] as const) {
    const large = new File(
      [
        await new JSZip()
          .file('a', bytes)
          .generateAsync({ type: 'arraybuffer', compression }),
      ],
      'large.zip',
    );
    const all = vi
      .spyOn(large, 'arrayBuffer')
      .mockRejectedValue(new Error('must slice'));
    const slices = vi.spyOn(large, 'slice');
    const reader = await BoundedZip.load(large, {
      ...limits,
      entry: 300000,
      total: 400000,
    });
    slices.mockClear();
    const restored = new Uint8Array(
      await (await reader.read('a')).arrayBuffer(),
    );
    expect(restored).toEqual(bytes);
    expect(all).not.toHaveBeenCalled();
    expect(slices.mock.calls.length).toBeGreaterThan(3);
    for (const [start, end] of slices.mock.calls)
      expect(end! - start!).toBeLessThanOrEqual(65536);
  }
});
