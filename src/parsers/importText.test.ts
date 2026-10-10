import { expect, it } from 'vitest';
import { importText } from './importText';
it('不支持的文件类型与超大文件在启动解析线程前拒绝', async () => {
  await expect(importText(new File(['内容'], 'book.pdf'))).rejects.toThrow(
    'TXT、EPUB 或 Markdown',
  );
  const file = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.epub');
  await expect(importText(file)).rejects.toThrow('超过 50 MB');
});
