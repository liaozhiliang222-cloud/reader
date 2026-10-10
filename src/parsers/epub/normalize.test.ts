import { expect, it } from 'vitest';
import { sanitizeChapter } from './sanitize';
import { decodeXml } from './xml';
const parse = (body: string, version: 1 | 2 = 2) =>
  sanitizeChapter(
    `<html><body>${body}</body></html>`,
    'chapter.xhtml',
    new Map(),
    version,
  );
it('列表和引用中的段前段后文字均可定位，祖先/行内注释锚点对应原文', () => {
  const result = parse(
    '<section id="chapter"><ul><li id="item">段前<p id="p">正文<a id="note"/>注释</p>段后</li></ul></section>',
  );
  expect(result.paragraphs).toEqual(['段前', '正文注释', '段后']);
  expect(result.anchors).toMatchObject({ chapter: 0, item: 0, p: 1, note: 1 });
});
it('表格按行保留单元格分隔与标题，诗歌换行/对齐、预格式文本保留', () => {
  const result = parse(
    '<table><caption>成绩</caption><tr><th>姓名</th><th>分数</th></tr><tr id="row"><td>甲</td><td><strong>九十</strong><script>危险</script></td></tr></table><p align="center">春风<br/>纸页</p><pre>第一行\n  第二行</pre>',
  );
  expect(result.paragraphs).toEqual([
    '成绩',
    '姓名 | 分数',
    '甲 | 九十',
    '春风纸页',
    '第一行\n  第二行',
  ]);
  expect(result.anchors.row).toBe(2);
  expect(result.nodes.at(-1)).toMatchObject({ tag: 'p', preformatted: true });
  expect(result.nodes.at(-2)).toMatchObject({
    align: 'center',
    children: ['春风', { tag: 'br', children: [] }, '纸页'],
  });
  expect(JSON.stringify(result)).not.toContain('危险');
});
it('旧解析版本保持原有段落与偏移，新规则不静默改变旧备份锚点', () => {
  const body =
    '<ul><li>段前<p>正文</p>段后</li></ul><table><tr><td>甲</td><td>乙</td></tr></table>';
  expect(parse(body, 1).paragraphs).toEqual(['正文', '甲乙']);
  expect(parse(body, 2).paragraphs).toEqual([
    '段前',
    '正文',
    '段后',
    '甲 | 乙',
  ]);
});
it('UTF-8与UTF-16LE/BE含BOM及XML签名都正确读取，非法序列明确拒绝', () => {
  const source = '<?xml version="1.0"?><p>中文😀</p>';
  expect(decodeXml(new TextEncoder().encode(source))).toBe(source);
  for (const little of [true, false])
    for (const bom of [true, false]) {
      const bytes = new Uint8Array((source.length + (bom ? 1 : 0)) * 2),
        view = new DataView(bytes.buffer);
      if (bom) view.setUint16(0, 0xfeff, little);
      for (let i = 0; i < source.length; i++)
        view.setUint16((i + (bom ? 1 : 0)) * 2, source.charCodeAt(i), little);
      expect(decodeXml(bytes)).toBe(source);
    }
  expect(() => decodeXml(Uint8Array.of(0xff, 0xff, 0xff))).toThrow('编码');
});
