import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown } from './markdown';
import { parseFile } from './file';
import { textOf, type SafeNode, type SafeElement } from './epub/sanitize';
import { chapterChunks, nodesForChunk } from '@/reader/chunks';

const elements = (nodes: SafeNode[]): SafeElement[] =>
  nodes.flatMap((node) =>
    typeof node === 'string' ? [] : [node, ...elements(node.children)],
  );
it('第二版公式、同文档双链、脚注与高亮语言识别，代码和转义不误解析', () => {
  const source =
    '# 文章\n\n前文 $x^2$ 与 \\(a+b\\) [[附录|继续阅读]] 引用[^中]。\n\n\\$x\\$ `$z$ [[假标题]]`\n\n$$\n\\frac{1}{2}\n$$\n\n```ts\nconst x = "$ignored$";\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n\n[^中]: **脚注正文**\n    第二行\n\n## 附录\n结尾';
  const parsed = parseMarkdown(source);
  expect(parsed.markdownVersion).toBe(2);
  const all = elements(parsed.chapters.flatMap((c) => c.nodes));
  expect(
    all.filter((n) => n.math !== undefined).map((n) => n.math?.trim()),
  ).toEqual(['x^2', 'a+b', '\\frac{1}{2}']);
  expect(all.find((n) => n.language === 'ts')?.children).toEqual([
    'const x = "$ignored$";',
  ]);
  expect(all.find((n) => n.diagram)?.diagram).toBe('graph TD; A-->B;');
  expect(all.find((n) => n.link === '#附录')?.children).toEqual(['继续阅读']);
  expect(parsed.toc.find((t) => t.anchor === 'md-note-中')?.title).toBe(
    '注释 1',
  );
  expect(parsed.chapters.at(-1)?.paragraphs.join('')).toContain('脚注正文');
  expect(
    parseMarkdown(source, 1)
      .chapters.flatMap((c) => elements(c.nodes))
      .some((n) => n.math || n.diagram || n.language),
  ).toBe(false);
});
it('价格、未定义脚注和跨书双链保留文字；重复脚注明确报错', () => {
  const parsed = parseMarkdown(
    '价格 $20 和 $30，未定义[^missing]，[[其他文件#标题]]',
  );
  const nodes = elements(parsed.chapters[0]!.nodes);
  expect(nodes.some((n) => n.math !== undefined || n.link)).toBe(false);
  expect(parsed.chapters[0]!.paragraphs[0]).toContain('[^missing]');
  expect(() => parseMarkdown('正文[^a]\n\n[^a]: 甲\n[^a]: 乙')).toThrow(
    '脚注名称重复',
  );
});
it('第二版原子公式在长段落分块边界保留完整源码和UTF16偏移', () => {
  const source =
    '# 长文\n\n' +
    '字'.repeat(11990) +
    '$' +
    'x+'.repeat(20) +
    '1$' +
    '字'.repeat(55000);
  const chapter = parseMarkdown(source).chapters[0]!;
  const chunks = chapterChunks(chapter);
  const recovered = new Map<number, string>();
  let mathCount = 0;
  for (const chunk of chunks) {
    const nodes = nodesForChunk(
      chapter.nodes,
      chunk,
      chapter.paragraphs,
      chunks,
    );
    mathCount += elements(nodes).filter((n) => n.math !== undefined).length;
    for (const node of elements(nodes).filter(
      (n) => n.paragraphIndex !== undefined,
    ))
      recovered.set(
        node.paragraphIndex!,
        (recovered.get(node.paragraphIndex!) ?? '') + textOf(node),
      );
  }
  expect(mathCount).toBe(1);
  expect([...recovered.values()]).toEqual(chapter.paragraphs);
});
it('图文包保留ZIP指纹，相对/编码路径引用本地附件，远程和穿越路径不加载', async () => {
  const zip = new JSZip();
  zip.file(
    '文章/正文.md',
    '# 图片\n\n![本地](../图片/示意.svg)\n\n![编码](../图片/%E7%A4%BA%E6%84%8F.svg)\n\n![远程](https://example.org/x.svg)\n\n![穿越](../../x.svg)',
  );
  zip.file(
    '图片/示意.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/><script>alert(1)</script></svg>',
  );
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const parsed = await parseFile(bytes, 'md');
  expect(parsed.markdownVersion).toBe(2);
  expect(parsed.assets).toHaveLength(1);
  expect(await parsed.assets[0]!.data.text()).not.toContain('script');
  const first = parsed.chapters[0]!;
  expect(
    elements('nodes' in first ? first.nodes : []).filter(
      (n) => n.tag === 'img',
    ),
  ).toHaveLength(2);
  expect(parsed.id).toMatch(/^md:[a-f0-9]{64}$/);
  await expect(parseFile(bytes, 'md', undefined, undefined, 1)).rejects.toThrow(
    '第二版',
  );
});
it('图文包拒绝多个正文与伪装图片，ZIP安全上限和CRC沿用已有管线', async () => {
  const multiple = new JSZip().file('a.md', '甲').file('b.md', '乙');
  await expect(
    parseFile(await multiple.generateAsync({ type: 'arraybuffer' }), 'md'),
  ).rejects.toThrow('只能包含一个');
  const invalid = new JSZip()
    .file('a.md', '正文')
    .file('a.png', '<script>boom</script>');
  await expect(
    parseFile(await invalid.generateAsync({ type: 'arraybuffer' }), 'md'),
  ).rejects.toThrow('图片格式');
});

it('只有本地图片的文档可阅读，脚注保留缩进的多个段落', () => {
  const image = parseMarkdown('![图](a.png)', 2, new Map([['a.png', 'asset']]));
  expect(image.chapters).toHaveLength(1);
  expect(image.chapters[0]!.paragraphs).toEqual(['']);
  expect(
    elements(image.chapters[0]!.nodes).find((n) => n.imageId)?.imageId,
  ).toBe('asset');
  const note = parseMarkdown('引用[^a]\n\n[^a]: 第一段\n\n    第二段');
  expect(note.chapters.at(-1)?.paragraphs).toEqual([
    '注释',
    '[1] ',
    '第一段',
    '第二段',
  ]);
});
