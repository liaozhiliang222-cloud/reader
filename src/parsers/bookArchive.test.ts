import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { archiveList, archiveRead } from './bookArchive';
async function archive(entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(entries)) zip.file(path, text);
  return new Blob([await zip.generateAsync({ type: 'arraybuffer' })]);
}
it('普通 ZIP 只列支持的书籍，读取原字节，排除嵌套容器与附件', async () => {
  const zip = await archive({
    '中文/甲.txt': '原文甲',
    '乙.md': '# 原文乙',
    '图.png': 'image',
    '嵌套.zip': 'archive',
  });
  expect((await archiveList(zip)).map((entry) => entry.path)).toEqual([
    '中文/甲.txt',
    '乙.md',
  ]);
  expect(await (await archiveRead(zip, '中文/甲.txt')).text()).toBe('原文甲');
  await expect(archiveRead(zip, '嵌套.zip')).rejects.toThrow('不递归');
});
it('EPUB 容器不当成普通 ZIP，路径穿越在扫描时拒绝', async () => {
  await expect(
    archiveList(await archive({ mimetype: 'application/epub+zip' })),
  ).rejects.toThrow('EPUB');
  await expect(
    archiveList(await archive({ '../secret.txt': 'x' })),
  ).rejects.toThrow();
});
