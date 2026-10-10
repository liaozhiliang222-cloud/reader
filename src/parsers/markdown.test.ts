import { expect, it } from 'vitest';
import { parseMarkdown as parse } from './markdown';
const parseMarkdown = (source: string, version = 1) => parse(source, version);
import { parseDraft } from './paste';
import { parseFile } from './file';
import { markdownLink } from './markdownLink';
import { textOf, type SafeNode, type SafeElement } from './epub/sanitize';
import { chapterChunks, nodesForChunk } from '@/reader/chunks';

function indexed(nodes: SafeNode[]): SafeElement[] {
  return nodes.flatMap((node) =>
    typeof node === 'string'
      ? []
      : node.paragraphIndex !== undefined
        ? [node]
        : indexed(node.children),
  );
}
it('GFM标题、重复锚点、引用、嵌套列表、任务和表格的文本与节点位置一致', () => {
  const result = parseMarkdown(
    '# 标题 &amp; 😀\n\n开场 **粗体** *斜体* ~~删除~~\n\n> 引用\n>\n> - 嵌套\n\n3. 第一项\n4. 第二项\n\n- [x] 已办\n- [ ] 待办\n\n| 名称 | 数值 |\n|---|---:|\n| 甲 | **12** |\n| 乙 | 23 |\n\n## 重复\n正文\n\n## 重复\n结尾',
  );
  expect(result.toc.map((t) => t.anchor)).toEqual(['标题--', '重复', '重复-1']);
  expect(result.chapters).toHaveLength(3);
  const paragraphs = result.chapters[0]!.paragraphs;
  expect(paragraphs).toContain('开场 粗体 斜体 删除');
  expect(paragraphs).toContain('☑ 已办');
  expect(paragraphs).toContain('☐ 待办');
  expect(paragraphs).toContain('名称：甲');
  expect(paragraphs).toContain('数值：12');
  for (const chapter of result.chapters) {
    expect(indexed(chapter.nodes).map(textOf)).toEqual(chapter.paragraphs);
    expect(indexed(chapter.nodes).map((n) => n.paragraphIndex)).toEqual(
      chapter.paragraphs.map((_, i) => i),
    );
  }
  expect(result.charCount).toBe(
    result.chapters
      .flatMap((c) => c.paragraphs)
      .reduce((n, p) => n + p.length, 0),
  );
});
it('代码保持缩进与实体原文，围栏中的标题不进入目录，公式与Mermaid保留源码', () => {
  const result = parseMarkdown(
    '# 正文\n\n```js\n  # 代码标题\n  a &amp; b\n```\n\n    缩进代码\n\n`x &lt;y&gt;`\n\n$$x^2$$\n\n```mermaid\ngraph TD; A-->B;\n```',
  );
  expect(result.toc.map((t) => t.title)).toEqual(['正文']);
  expect(result.chapters[0]!.paragraphs).toEqual([
    '正文',
    '  # 代码标题\n  a &amp; b',
    '缩进代码',
    'x &lt;y&gt;',
    '$$x^2$$',
    'graph TD; A-->B;',
  ]);
});
it('HTML和危险URL只保留文字，图片没有网络源；实体和UTF16锚点稳定', () => {
  const source =
    '# 安全\n\n&lt;b&gt; &#x1F600; &copy;\n\n<script>alert(1)</script>\n\n<img src="https://example.org/x" onerror="alert(1)">\n\n![示意](https://example.org/image.png) [危险](javascript:alert%281%29) [跳转](#安全) [外链](https://example.org)';
  const result = parseMarkdown(source);
  expect(result.chapters[0]!.paragraphs).toContain('<b> 😀 ©');
  const all: SafeElement[] = [];
  const collect = (nodes: SafeNode[]) =>
    nodes.forEach((n) => {
      if (typeof n !== 'string') {
        all.push(n);
        collect(n.children);
      }
    });
  collect(result.chapters[0]!.nodes);
  expect(all.some((n) => ['script', 'img', 'iframe'].includes(n.tag))).toBe(
    false,
  );
  expect(all.filter((n) => n.link).map((n) => n.link)).toEqual([
    '#安全',
    'https://example.org/',
  ]);
  expect(markdownLink('https://example.org/\nfoo')).toBeUndefined();
  expect(markdownLink('data:text/html,x')).toBeUndefined();
  expect(parseMarkdown(source)).toEqual(result);
});
it('文件、MD文稿与纯文本指纹隔离，文件指纹来自原始字节', async () => {
  const source = '# 示例\n\n**正文**';
  const bytes = new TextEncoder().encode(source).buffer;
  const file = await parseFile(bytes, 'md', undefined, undefined, 1),
    plainFile = await parseFile(bytes, 'txt');
  const draft = await parseDraft(source, 'markdown', 1),
    plain = await parseDraft(source);
  expect(file.id).toBe('md:' + plainFile.id);
  expect(draft.id).toBe('paste-md:' + plainFile.id);
  expect(plain.id).toBe('paste:' + plainFile.id);
  expect(file.chapters).toEqual(draft.chapters);
  expect(file.markdownVersion).toBe(1);
  await expect(parseFile(bytes, 'md', undefined, undefined, 3)).rejects.toThrow(
    '版本',
  );
});
it('大型代码块分块后UTF16文本不丢失，保留代码与链接结构', () => {
  const result = parseMarkdown(
    '# 长文\n\n```\n' + '  代码😀'.repeat(13000) + '\n```\n\n[末尾](#长文)',
  );
  const chapter = result.chapters[0]!;
  const chunks = chapterChunks(chapter);
  expect(chunks.length).toBeGreaterThan(1);
  const recovered = new Map<number, string>();
  for (const chunk of chunks)
    for (const node of indexed(
      nodesForChunk(chapter.nodes, chunk, chapter.paragraphs, chunks),
    ))
      recovered.set(
        node.paragraphIndex!,
        (recovered.get(node.paragraphIndex!) ?? '') + textOf(node),
      );
  expect([...recovered.values()]).toEqual(chapter.paragraphs);
});
it('空正文、只含定义和未知结构版本明确拒绝', () => {
  expect(() => parseMarkdown(' ')).toThrow('没有可阅读');
  expect(() => parseMarkdown('[a]: https://example.org')).toThrow('没有可阅读');
  expect(() => parseMarkdown('#\n\n##')).toThrow('没有可阅读');
  expect(() => parseMarkdown('正文', 3)).toThrow('版本');
});
it('空标题不产生无名目录项，首个正文回退为书名，自动标题按Unicode截断', () => {
  const result = parseMarkdown('#\n\n这里是正文');
  expect(result.title).toBe('这里是正文');
  expect(result.chapters[0]?.title).toBe('正文');
  expect(result.toc).toEqual([]);
  expect(result.chapters[0]?.paragraphs).toEqual(['', '这里是正文']);
  expect([...parseMarkdown('# ' + '😀'.repeat(40)).title]).toHaveLength(30);
});
it('实体名称不会变为HTML、非法Unicode数值降级，块引用任务的顺序与定位一致', () => {
  const result = parseMarkdown(
    '# 测试\n\n&lt;img src=x&gt; &#0; &#x110000; &unknown; &amp;lt;\n\n- [x] > 引用中的任务',
  );
  expect(result.chapters[0]!.paragraphs[1]).toBe(
    '<img src=x> � � &unknown; &lt;',
  );
  expect(indexed(result.chapters[0]!.nodes).map(textOf)).toEqual(
    result.chapters[0]!.paragraphs,
  );
  expect(result.chapters[0]!.paragraphs.some((p) => p.startsWith('☑ '))).toBe(
    true,
  );
});
it('有序列表跨块后沿用原条目序号，正文规范与切片一致', () => {
  const chapter = parseMarkdown(
    '# 列表\n\n' +
      Array.from(
        { length: 1000 },
        (_, i) => `${i + 3}. 第${i}项 ${'文字'.repeat(40)}`,
      ).join('\n'),
  ).chapters[0]!;
  const chunks = chapterChunks(chapter);
  const nodes = nodesForChunk(
    chapter.nodes,
    chunks[1]!,
    chapter.paragraphs,
    chunks,
  );
  const list = nodes.find(
    (n): n is SafeElement => typeof n !== 'string' && n.tag === 'ol',
  )!;
  const first = indexed(list.children)[0]!;
  expect(list.start).toBe(first.paragraphIndex! + 2);
  expect(textOf(first)).toBe(
    chapter.paragraphs[first.paragraphIndex!]!.slice(
      chunks[1]!.paragraphs[0]!.start,
    ),
  );
});
