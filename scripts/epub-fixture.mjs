// 自编 EPUB 浏览器回归样本，不含第三方书籍内容。
import JSZip from 'jszip';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(240);
header.writeUInt32BE(320, 4);
header[8] = 8;
header[9] = 2;
const rows = Buffer.alloc(320 * 721);
for (let y = 0; y < 320; y++)
  for (let x = 0; x < 240; x++) {
    const at = y * 721 + 1 + x * 3;
    rows[at] = 100 + y / 3;
    rows[at + 1] = 140 + x / 4;
    rows[at + 2] = 130;
  }
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0)),
]);
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip');
zip.file(
  'META-INF/container.xml',
  '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
);
zip.file(
  'OPS/book.opf',
  '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>纸间漫步 · EPUB 回归</dc:title><dc:creator>静页测试</dc:creator></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="nav" href="nav.xhtml" properties="nav"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
);
zip.file('OPS/cover.png', png);
zip.file(
  'OPS/a.xhtml',
  '<html><body><h1>第一章 纸间漫步</h1><p>这是一段<strong>加粗文字</strong>和<em>斜体文字</em>，用于验证嵌套文本的阅读定位。</p><p><img src="cover.png" alt="自编绿色渐变插图"/></p>' +
    Array.from(
      { length: 35 },
      (_, i) =>
        `<p id="p${i}">第${i + 1}段。${'微风翻过纸页，窗边的光慢慢移动。<strong>阅读的位置应当保持稳定。</strong>'.repeat(6)}</p>`,
    ).join('') +
    '<script>alert("不应执行")</script><img src="https://example.invalid/track.png"/></body></html>',
);
zip.file(
  'OPS/b.xhtml',
  '<html><body><h1>第二章 山色</h1><ul><li>第一条记录</li><li>第二条记录</li></ul><p>后章已到达。</p></body></html>',
);
zip.file(
  'OPS/nav.xhtml',
  '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="a.xhtml">纸间漫步</a><ol><li><a href="a.xhtml#p12">第十三段</a></li></ol></li><li><a href="b.xhtml">山色</a></li></ol></nav></body></html>',
);
await mkdir('test-books', { recursive: true });
await writeFile(
  'test-books/epub-regression.epub',
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
);
