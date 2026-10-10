import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { parseEpub } from './parse';
const encryption = (
  method = 'http://www.idpf.org/2008/embedding',
  uri = 'OPS/font.ttf',
) =>
  `<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${method}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
async function fixture(enc: string, fontType = 'font/ttf', includeFont = true) {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  );
  zip.file('META-INF/encryption.xml', enc);
  zip.file(
    'OPS/book.opf',
    `<package><metadata><title>字体混淆样本</title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="font" href="font.ttf" media-type="${fontType}"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
  );
  zip.file(
    'OPS/chapter.xhtml',
    '<html><body><p>正文可读，字体由阅读器统一控制。</p></body></html>',
  );
  if (includeFont) zip.file('OPS/font.ttf', Uint8Array.of(1, 2, 3, 4));
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
it('仅字体使用IDPF混淆时可打开，不加载包内字体；兼容旧font-sfnt MIME', async () => {
  for (const mime of ['font/ttf', 'application/font-sfnt']) {
    const book = await parseEpub(await fixture(encryption(), mime), 'test');
    expect(book.chapters[0]?.paragraphs).toEqual([
      '正文可读，字体由阅读器统一控制。',
    ]);
    expect(book.assets).toEqual([]);
    expect(book.toc[0]?.chapterIndex).toBe(0);
  }
});
it('正文加密、未知算法、混合加密和EncryptedKey拒绝', async () => {
  for (const source of [
    encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc'),
    encryption('unknown'),
    encryption().replace('</encryption>', '<enc:EncryptedKey/></encryption>'),
    encryption().replace(
      '</encryption>',
      '<enc:EncryptedData><enc:EncryptionMethod Algorithm="unknown"/></enc:EncryptedData></encryption>',
    ),
  ])
    await expect(parseEpub(await fixture(source), 'test')).rejects.toThrow(
      '版权保护',
    );
});
it('不能把正文、图片、缺失字体或外部资源伪装成规范字体混淆', async () => {
  await expect(
    parseEpub(
      await fixture(encryption(undefined, 'OPS/chapter.xhtml')),
      'test',
    ),
  ).rejects.toThrow('非字体');
  await expect(
    parseEpub(await fixture(encryption(), 'image/png'), 'test'),
  ).rejects.toThrow('非字体');
  await expect(
    parseEpub(await fixture(encryption(), 'font/ttf', false), 'test'),
  ).rejects.toThrow('缺失');
  await expect(
    parseEpub(
      await fixture(encryption(undefined, 'https://example.invalid/font.ttf')),
      'test',
    ),
  ).rejects.toThrow('资源路径');
  await expect(
    parseEpub(await fixture('<encryption/>'), 'test'),
  ).rejects.toThrow('信息不完整');
});
