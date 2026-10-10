// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { parseMarkdown } from '@/parsers/markdown';
import { renderNodes } from './content';
import { canonicalText } from './text';
import { rangeForSpan, spanFromRange } from './selection';
import { HighlightLayer } from './highlight';
import { allowedDiagram } from './markdownDiagram';

it('公式可视化与代码高亮不改变规范文字和公式后的选区/划线偏移', async () => {
  const chapter = parseMarkdown(
    '# 示例\n\n前 $x^2$ 后😀文\n\n```ts\nconst value = 42;\n```',
  ).chapters[0]!;
  const rendered = await renderNodes(chapter.nodes);
  const root = document.createElement('div');
  root.append(rendered.fragment);
  document.body.append(root);
  expect(root.querySelector('math')).not.toBeNull();
  expect(root.querySelector('.hljs-number')?.textContent).toBe('42');
  expect([...root.querySelectorAll('[data-p]')].map(canonicalText)).toEqual(
    chapter.paragraphs,
  );
  const p = chapter.paragraphs[1]!,
    start = p.indexOf('后');
  const span = {
    chapterIndex: 0,
    start: { paragraphIndex: 1, charOffset: start },
    end: { paragraphIndex: 1, charOffset: p.length },
  };
  const range = rangeForSpan(root, span)!;
  expect(spanFromRange(root, 0, chapter.paragraphs, range)).toEqual({
    ...span,
    text: '后😀文',
  });
  const layer = new HighlightLayer(false);
  layer.render(
    [{ root, chapter }],
    [
      {
        ...span,
        id: 'md-mark',
        bookId: 'md:book',
        text: '后😀文',
        color: 'yellow',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  );
  expect(root.querySelector('mark')?.textContent).toBe('后😀文');
  expect(root.querySelector('math mark')).toBeNull();
  expect([...root.querySelectorAll('[data-p]')].map(canonicalText)).toEqual(
    chapter.paragraphs,
  );
  layer.dispose();
  root.remove();
  rendered.release();
});
it('恶意/错误公式回退源码，不生成链接、图片或请求来源', async () => {
  const chapter = parseMarkdown(
    '# 安全\n\n$\\includegraphics{https://example.org/x}$ $\\unknowncommand$',
  ).chapters[0]!;
  const rendered = await renderNodes(chapter.nodes);
  const root = document.createElement('div');
  root.append(rendered.fragment);
  expect(root.querySelector('a,img,[href],[src]')).toBeNull();
  expect(root.querySelector('math')).toBeNull();
  expect([...root.querySelectorAll('[data-p]')].map(canonicalText)).toEqual(
    chapter.paragraphs,
  );
  rendered.release();
});
it('图表渲染前拒绝资源、HTML、配置、CSS和交互指令，允许常用安全语法', () => {
  expect(allowedDiagram('graph TD; A-->B;')).toBe(true);
  expect(allowedDiagram('sequenceDiagram\nAlice->>Bob: 你好')).toBe(true);
  for (const source of [
    'graph TD\nclick A "https://x"',
    'graph TD\nA@{ img: "x" }',
    'graph TD\nclassDef bad fill:red',
    '%%{init: {}}%%\ngraph TD; A-->B;',
    '---\nconfig: x\n---\ngraph TD',
    'graph TD\nA["<img src=x>"]',
  ])
    expect(allowedDiagram(source)).toBe(false);
});
