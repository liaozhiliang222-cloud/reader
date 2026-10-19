import { expect, it } from 'vitest';
import { encodeIncoming, decodeIncoming } from './incomingRecord';
it('iOS multipart 用 ASCII 占位名，中文真实名与字节在持久化后完整恢复', async () => {
  const file = new File(['原创内容😀'], '中文书名.md', {
    type: 'text/markdown',
  });
  const encoded = await encodeIncoming(crypto.randomUUID(), {
    files: [file],
    title: '',
    text: '',
    errors: [],
  });
  const decoded = await decodeIncoming(encoded);
  expect(decoded.files[0]?.name).toBe(file.name);
  expect(await decoded.files[0]?.text()).toBe(await file.text());
  expect(encoded.value.names).toEqual([file.name]);
  await expect(
    decodeIncoming({ ...encoded, value: { ...encoded.value, names: [] } }),
  ).rejects.toThrow('文件名');
});
