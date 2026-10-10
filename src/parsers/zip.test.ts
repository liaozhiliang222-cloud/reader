import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { BoundedZip, type ZipLimits } from './zip';
const limits: ZipLimits = {
  input: 1024 * 1024,
  entries: 20,
  entry: 100000,
  total: 200000,
};
async function pack(
  files: Record<string, string>,
  compression: 'STORE' | 'DEFLATE' = 'DEFLATE',
) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return zip.generateAsync({ type: 'arraybuffer', compression });
}
function central(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  for (let index = 0; index < buffer.byteLength - 46; index++)
    if (view.getUint32(index, true) === 0x02014b50) return { view, index };
  throw new Error('fixture has no central entry');
}
it('STORE/DEFLATE分块读取保持字节，空文件可读，未使用条目校验后不保留内容', async () => {
  for (const compression of ['STORE', 'DEFLATE'] as const) {
    const source = '😀甲乙'.repeat(10000),
      zip = await BoundedZip.load(
        await pack(
          { 'a.txt': source, empty: '', unused: '123456789' },
          compression,
        ),
        limits,
      );
    expect(await (await zip.read('a.txt')).text()).toBe(source);
    expect((await zip.read('empty')).size).toBe(0);
    await zip.verifyRemaining();
    expect(zip.has('missing')).toBe(false);
    await expect(zip.read('missing')).rejects.toThrow('缺少');
  }
});
it('输入、条目数、单条和总解压声明上限在读取正文前拒绝', async () => {
  const buffer = await pack({ a: 'a'.repeat(60), b: 'b'.repeat(60) });
  await expect(
    BoundedZip.load(buffer, { ...limits, input: 1 }),
  ).rejects.toThrow('文件过大');
  await expect(
    BoundedZip.load(buffer, { ...limits, entries: 1 }),
  ).rejects.toThrow('数量');
  await expect(
    BoundedZip.load(buffer, { ...limits, entry: 50 }),
  ).rejects.toThrow('解压');
  await expect(
    BoundedZip.load(buffer, { ...limits, total: 100 }),
  ).rejects.toThrow('解压');
  const zip = await BoundedZip.load(buffer, limits);
  await expect(zip.read('a', 50)).rejects.toThrow('大小超限');
});
it('伪造小的解压长度不能绕过实际流上限，失败后停止整个包的后续读取', async () => {
  const buffer = await pack({ a: 'x'.repeat(50000), b: 'safe' });
  const { view, index } = central(buffer);
  view.setUint32(index + 24, 10, true);
  // Both declarations agree, so the streaming check must catch the real body.
  view.setUint32(22, 10, true);
  const zip = await BoundedZip.load(buffer, { ...limits, entry: 1000 });
  await expect(zip.read('a')).rejects.toThrow('实际解压大小');
  await expect(zip.read('b')).rejects.toThrow('已停止');
});
it('CRC不符的引用资源及未使用资源都拒绝，不返回部分正文', async () => {
  const buffer = await pack({ 'a.txt': '123456789' }, 'STORE');
  const { view, index } = central(buffer);
  view.setUint32(index + 16, 0, true);
  view.setUint32(14, 0, true);
  const zip = await BoundedZip.load(buffer, limits);
  await expect(zip.read('a.txt')).rejects.toThrow('CRC');
  const other = await BoundedZip.load(buffer, limits);
  await expect(other.verifyRemaining()).rejects.toThrow('CRC');
});
it('重复解压计入累计实际工作量，目录穿越和绝对路径拒绝', async () => {
  const zip = await BoundedZip.load(await pack({ a: 'a'.repeat(60) }), {
    ...limits,
    total: 100,
  });
  await zip.read('a');
  await expect(zip.read('a')).rejects.toThrow('实际解压大小');
  for (const path of ['../a', '/a', 'x\\a', 'C:/a'])
    await expect(
      BoundedZip.load(await pack({ [path]: 'bad' }), limits),
    ).rejects.toThrow('路径');
});
