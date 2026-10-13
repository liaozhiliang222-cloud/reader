import { describe, expect, it } from 'vitest';
import type { SafeNode } from '@/parsers/epub/sanitize';
import type { StoredChapter } from '@/types';
import { analyzeChapter, chapterSentences } from './extract';

const chapter = (paragraphs: string[], nodes?: SafeNode[]): StoredChapter => ({
  bookId: 'b1',
  index: 0,
  title: '章',
  paragraphs,
  charStart: 0,
  charCount: paragraphs.join('').length,
  nodes,
});

const el = (
  tag: string,
  children: SafeNode[],
  extra: Record<string, unknown> = {},
): SafeNode => ({ tag, children, ...extra }) as SafeNode;

describe('可朗读抽取', () => {
  it('无 nodes 的 TXT 章节全部非空段落可读', () => {
    const c = chapter(['甲。乙。', '   ', '丙！']);
    const out = chapterSentences(c);
    expect(out.map((s) => s.text)).toEqual(['甲。', '乙。', '丙！']);
    expect(out[0]!.start).toEqual({
      chapterIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
    expect(out[2]!.start).toEqual({
      chapterIndex: 0,
      paragraphIndex: 2,
      charOffset: 0,
    });
  });

  it('代码块、公式、Mermaid、表格、图片占位整段跳过', () => {
    const c = chapter(
      ['正文。', 'x = 1', 'y=∫f(x)', 'flowchart', 'a|b', 'img', '结尾。'],
      [
        el('p', ['正文。'], { paragraphIndex: 0 }),
        el('pre', ['x = 1'], { paragraphIndex: 1, preformatted: true }),
        el('div', ['y=∫f(x)'], { paragraphIndex: 2, math: 'y' }),
        el('div', ['flowchart'], { paragraphIndex: 3, diagram: 'm' }),
        el('table', ['a|b'], { paragraphIndex: 4, kind: 'table' }),
        el('span', ['img'], { paragraphIndex: 5, kind: 'image-placeholder' }),
        el('p', ['结尾。'], { paragraphIndex: 6 }),
      ],
    );
    expect(chapterSentences(c).map((s) => s.text)).toEqual([
      '正文。',
      '结尾。',
    ]);
    const { skipped } = analyzeChapter(c);
    expect([...skipped].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('rt 注音不读且 sourceRanges 指回原文区间', () => {
    // 段落原文含注音字 "漢(かん)"。
    const c = chapter(
      ['漢かん字。'],
      [
        el('p', [el('ruby', ['漢', el('rt', ['かん'])]), '字。'], {
          paragraphIndex: 0,
        }),
      ],
    );
    const out = chapterSentences(c);
    expect(out.map((s) => s.text)).toEqual(['漢字。']);
    expect(out[0]!.sourceRanges).toEqual([
      { paragraphIndex: 0, start: 0, end: 1 },
      { paragraphIndex: 0, start: 3, end: 5 },
    ]);
  });

  it('链接元素只读显示文字', () => {
    const c = chapter(
      ['点这里继续。'],
      [
        el('p', ['点', el('a', ['这里'], { link: 'https://x' }), '继续。'], {
          paragraphIndex: 0,
        }),
      ],
    );
    expect(chapterSentences(c).map((s) => s.text)).toEqual(['点这里继续。']);
  });

  it('整章无可读内容时返回空数组', () => {
    const c = chapter(
      ['   ', 'code'],
      [
        el('p', ['   '], { paragraphIndex: 0 }),
        el('pre', ['code'], { paragraphIndex: 1, preformatted: true }),
      ],
    );
    expect(chapterSentences(c)).toEqual([]);
  });

  it('句子 locator 与 sourceRanges 均为 UTF-16 原文字符偏移', () => {
    const c = chapter(
      ['😀甲。乙。'],
      [el('p', ['😀甲。乙。'], { paragraphIndex: 0 })],
    );
    const out = chapterSentences(c);
    expect(out[0]!.text).toBe('😀甲。');
    expect(out[0]!.start.charOffset).toBe(0);
    expect(out[0]!.end.charOffset).toBe(4); // emoji 占 2 个 UTF-16 单元
    expect(out[1]!.start.charOffset).toBe(4);
  });
});
