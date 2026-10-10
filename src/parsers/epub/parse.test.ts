import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { parseEpub } from './parse';
import { sanitizeChapter } from './sanitize';
import { resolvePath } from './xml';

async function fixture(mode: 'nav' | 'ncx' | 'none' | 'drm' = 'nav') {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  );
  zip.file(
    'OPS/book.opf',
    `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>静夜测试</dc:title><dc:creator>自编作者</dc:creator></metadata><manifest><item id="a" href="text/a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="text/b.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="nav" href="nav.xhtml" properties="${mode === 'nav' ? 'nav' : ''}"/><item id="ncx" href="toc.ncx" media-type="${mode === 'ncx' ? 'application/x-dtbncx+xml' : 'other'}"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`,
  );
  zip.file(
    'OPS/text/a.xhtml',
    '<html><body><h1 id="start">第一章</h1><p>甲<strong>乙</strong></p><img src="../cover.png"/></body></html>',
  );
  zip.file(
    'OPS/text/b.xhtml',
    '<html><body><p>前段</p><p id="part">目标段</p></body></html>',
  );
  zip.file(
    'OPS/nav.xhtml',
    '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/b.xhtml">开篇</a><ol><li><a href="text/b.xhtml#part">片段</a></li></ol></li><li><a href="text/a.xhtml#start">后章</a></li></ol></nav></body></html>',
  );
  zip.file(
    'OPS/toc.ncx',
    '<ncx><navMap><navPoint><navLabel><text>开篇</text></navLabel><content src="text/b.xhtml"/><navPoint><navLabel><text>片段</text></navLabel><content src="text/b.xhtml#part"/></navPoint></navPoint></navMap></ncx>',
  );
  zip.file('OPS/cover.png', Uint8Array.of(137, 80, 78, 71));
  if (mode === 'drm')
    zip.file(
      'META-INF/encryption.xml',
      '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="OPS/text/a.xhtml"/></CipherData></EncryptedData></encryption>',
    );
  return zip.generateAsync({ type: 'arraybuffer' });
}
it('EPUB3读取元数据、spine顺序、多级目录和fragment，图片保存在本地', async () => {
  const book = await parseEpub(await fixture(), 'hash');
  expect(book.title).toBe('静夜测试');
  expect(book.author).toBe('自编作者');
  expect(book.chapters[0]?.paragraphs).toEqual(['前段', '目标段']);
  expect(book.toc).toEqual([
    { title: '开篇', chapterIndex: 0, paragraphIndex: 0, level: 0 },
    { title: '片段', chapterIndex: 0, paragraphIndex: 1, level: 1 },
    { title: '后章', chapterIndex: 1, paragraphIndex: 0, level: 0 },
  ]);
  expect(book.coverBlobId).toBe('hash:image:0');
  expect(book.assets[0]?.data.type).toBe('image/png');
  expect(book.chapters[1]?.charStart).toBe(5);
});
it('EPUB2使用NCX嵌套层级', async () => {
  const book = await parseEpub(await fixture('ncx'), 'hash');
  expect(book.toc[1]).toEqual({
    title: '片段',
    chapterIndex: 0,
    paragraphIndex: 1,
    level: 1,
  });
});
it('无目录按spine生成默认项', async () => {
  const book = await parseEpub(await fixture('none'), 'hash');
  expect(book.toc.map((t) => t.title)).toEqual(['第 1 节', '第 2 节']);
});
it('部分目录补齐缺失正文，保留原fragment和旧定位版本的目录行为', async () => {
  const zip = await JSZip.loadAsync(await fixture());
  zip.file(
    'OPS/nav.xhtml',
    '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/a.xhtml#start">后章</a></li></ol></nav></body></html>',
  );
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const modern = await parseEpub(bytes, 'hash', 2);
  const legacy = await parseEpub(bytes, 'hash', 1);
  expect(modern.toc).toEqual([
    { title: '第 1 节', chapterIndex: 0, paragraphIndex: 0, level: 0 },
    { title: '后章', chapterIndex: 1, paragraphIndex: 0, level: 0 },
  ]);
  expect(legacy.toc).toEqual(modern.toc.slice(1));
  expect(modern.chapters.map((chapter) => chapter.paragraphs)).toEqual(
    legacy.chapters.map((chapter) => chapter.paragraphs),
  );
  expect(modern.chapters.map((chapter) => chapter.anchors)).toEqual(
    legacy.chapters.map((chapter) => chapter.anchors),
  );
});
it('加密、损坏与缺少结构的文件不能解析为书籍', async () => {
  await expect(parseEpub(await fixture('drm'), 'hash')).rejects.toThrow(
    '版权保护',
  );
  await expect(parseEpub(new ArrayBuffer(12), 'hash')).rejects.toThrow(
    '文件无法解析',
  );
  await expect(
    parseEpub(await new JSZip().generateAsync({ type: 'arraybuffer' }), 'hash'),
  ).rejects.toThrow('缺少');
});
it('白名单节点剥离脚本、事件、外链和危险容器，保留强调与对齐', () => {
  const result = sanitizeChapter(
    '<html><body><script>alert(1)</script><iframe src="https://bad.test"/><p onclick="bad()" style="color:red;text-align:center;background:url(https://bad.test)">甲<strong>乙</strong><a href="https://bad.test">丙</a><img src="https://bad.test/a.png" onerror="bad()"/></p><svg onload="bad()"/></body></html>',
    'a.xhtml',
    new Map(),
  );
  expect(result.paragraphs).toEqual(['甲乙丙']);
  expect(result.nodes[0]).toMatchObject({
    tag: 'p',
    align: 'center',
    paragraphIndex: 0,
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(/bad|https|onclick|script|iframe|svg|onerror/);
});
it('散落文本、列表和图片按阅读顺序编号，不重复统计', () => {
  const result = sanitizeChapter(
    '<html><body>导语<p id="a">正文</p><blockquote><ul><li>列表</li></ul></blockquote><img src="a.png"/></body></html>',
    'a.xhtml',
    new Map([['a.png', 'image']]),
  );
  expect(result.paragraphs).toEqual(['导语', '正文', '列表', '']);
  expect(result.anchors.a).toBe(1);
});
it('路径解析允许书内相对路径，拒绝外部资源和越界', () => {
  expect(resolvePath('OPS/text/a.xhtml', '../images/a%20b.png#x')).toEqual({
    path: 'OPS/images/a b.png',
    fragment: 'x',
  });
  for (const value of [
    'https://bad.test/a',
    '//bad.test/a',
    '../../a',
    '%2Fetc/passwd',
    'javascript:bad()',
  ])
    expect(() => resolvePath('a.xhtml', value)).toThrow();
});
