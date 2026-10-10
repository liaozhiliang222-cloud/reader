// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { parseMarkdown } from '@/parsers/markdown';
import { renderNodes } from './content';

it('安全节点渲染的段落textContent与UTF16规范正文完全一致，外链没有href或src', async () => {
  const result = parseMarkdown(
    '# 示例😀\n\n硬换行  \n下一行 &copy;\n\n- [x] **任务**\n\n| 列 | 值 |\n|---|---|\n| A | `B` |\n\n```\n  <code> &amp;\n```\n\n![图片](https://example.org/image) [链接](https://example.org)',
  );
  const rendered = await renderNodes(result.chapters[0]!.nodes);
  const host = document.createElement('div');
  host.append(rendered.fragment);
  expect(
    [...host.querySelectorAll('[data-p]')].map((el) => el.textContent),
  ).toEqual(result.chapters[0]!.paragraphs);
  expect(host.querySelector('[href],[src],script,img')).toBeNull();
  expect(host.querySelector('a')?.getAttribute('role')).toBe('button');
  expect(host.querySelector<HTMLAnchorElement>('a')?.tabIndex).toBe(0);
  expect(host.querySelector('a')?.getAttribute('data-md-link')).toBe(
    'https://example.org/',
  );
  rendered.release();
});
