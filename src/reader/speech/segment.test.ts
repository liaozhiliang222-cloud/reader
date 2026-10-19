import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/parsers/markdown';
import { sanitizeChapter } from '@/parsers/epub/sanitize';
import type { SafeNode } from '@/parsers/epub/sanitize';
import type { StoredChapter } from '@/types';
import { extractSpeech } from './extract';
import { segmentChapter, sentenceSlices } from './segment';

function chapter(paragraphs: string[], nodes?: SafeNode[]): StoredChapter {
  return {
    bookId: 'synthetic',
    index: 0,
    title: '原创测试',
    paragraphs,
    nodes,
    charStart: 0,
    charCount: paragraphs.reduce((sum, p) => sum + p.length, 0),
  };
}
const text = (source: string, limit = 120) =>
  sentenceSlices(source, limit).map((r) => source.slice(r.start, r.end));

describe('speech segmentation and original UTF-16 anchors', () => {
  it('keeps Chinese closing quotes and punctuation with the sentence', () => {
    expect(
      text('他说：“早上好！”她答：「你好。」然后出发；终于到了……休息。'),
    ).toEqual([
      '他说：“早上好！”',
      '她答：「你好。」',
      '然后出发；',
      '终于到了……',
      '休息。',
    ]);
  });
  it('preserves English abbreviations, decimal numbers and ellipses', () => {
    expect(
      text('Mr. Lee met Dr. Wu. Use e.g. 3.14 items! Wait... "Ready?" Yes.'),
    ).toEqual([
      'Mr. Lee met Dr. Wu.',
      'Use e.g. 3.14 items!',
      'Wait...',
      '"Ready?"',
      'Yes.',
    ]);
  });
  it('does not split surrogate pairs, even with a very small engine limit', () => {
    const original = '你😀好。Hello世界! ' + '😀'.repeat(137) + '继续';
    for (const limit of [2, 3, 119, 120]) {
      for (const fragment of text(original, limit)) {
        expect(fragment.length).toBeLessThanOrEqual(limit);
        expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(fragment)).toBe(false);
      }
    }
    expect(text('😀'.repeat(137)).join('')).toBe('😀'.repeat(137));
  });
  it('prefers commas for long sentences while preserving every audible character', () => {
    const original = '甲'.repeat(70) + '，' + '乙'.repeat(170) + '。';
    const sentences = text(original);
    expect(sentences[0]).toBe('甲'.repeat(70) + '，');
    expect(sentences.join('')).toBe(original);
    expect(sentences.every((s) => s.length <= 120)).toBe(true);
  });
  it('skips blanks and pure punctuation without pretending an empty book is completed', () => {
    expect([
      ...segmentChapter(chapter(['', '  ', '……！？', '---']), 0),
    ]).toEqual([]);
    expect(text('123。😀！')).toEqual(['123。', '😀！']);
  });
  it('gives repeated sentences different identities and includes the content revision', () => {
    const input = chapter(['同一句。同一句。', '同一句。']);
    const first = [...segmentChapter(input, 0)];
    expect(new Set(first.map((s) => s.id)).size).toBe(3);
    expect([...segmentChapter(input, 1)].map((s) => s.id)).not.toEqual(
      first.map((s) => s.id),
    );
    expect(first[1]?.start.charOffset).toBe(4);
    expect(first[2]?.start.paragraphIndex).toBe(1);
  });
  it('finds the containing sentence from a page/chunk anchor and moves forward from whitespace', () => {
    const input = chapter(['第一句。  第二句😀。', '', '第三句。']);
    const at = (paragraphIndex: number, charOffset: number) =>
      [
        ...segmentChapter(input, 0, 120, {
          chapterIndex: 0,
          paragraphIndex,
          charOffset,
        }),
      ][0];
    expect(at(0, 2)?.text).toBe('第一句。');
    expect(at(0, 5)?.text).toBe('第二句😀。');
    expect(at(0, 9)?.start.charOffset).toBe(6);
    expect(at(1, 0)?.text).toBe('第三句。');
    expect(at(2, 4)).toBeUndefined();
  });
  it('keeps TXT code-like text because plain text does not carry semantic exclusion flags', () => {
    expect([
      ...segmentChapter(
        chapter(['const answer = 42;', '$x^2$', 'graph TD; A-->B;']),
        0,
      ),
    ]).toHaveLength(3);
  });
  it('rejects invalid engine limits and revisions', () => {
    for (const limit of [0, 1, 120.5, NaN, Infinity, 4001])
      expect(() => text('正文', limit)).toThrow();
    expect(() => [...segmentChapter(chapter(['正文']), NaN)]).toThrow();
  });
});

describe('safe-node speech extraction', () => {
  it('filters Markdown code/math/diagrams/images/tables, retaining visible link and wiki text', () => {
    const parsed = parseMarkdown(
      '# 听书\n\n早上 **好**。\n\n```js\nsecret_code()\n```\n\n公式 $x^2$ 后继续。\n\n$$y=1$$\n\n```mermaid\ngraph TD; A-->B;\n```\n\n![图片](https://example.com/x.png)\n\n|列|值|\n|---|---|\n|甲|乙|\n\n[微光阅读](https://example.com)与[[听书|显示名]]。',
    );
    const input = { ...parsed.chapters[0]!, bookId: 'md' };
    const sentences = [...segmentChapter(input, 0)];
    const speech = sentences.map((s) => s.text).join('');
    expect(speech).toContain('早上 好。');
    expect(speech).toContain('公式  后继续。');
    expect(speech).toContain('微光阅读与显示名。');
    for (const forbidden of [
      'secret',
      'x^2',
      'y=1',
      'graph',
      '图片',
      '甲',
      'https:',
      'example',
    ])
      expect(speech).not.toContain(forbidden);
    const formula = sentences.find((s) => s.text.includes('后继续'))!;
    expect(formula.sourceRanges).toHaveLength(2);
    expect(
      formula.sourceRanges
        .map((r) =>
          input.paragraphs[r.start.paragraphIndex]!.slice(
            r.start.charOffset,
            r.end.charOffset,
          ),
        )
        .join(''),
    ).toBe(formula.text);
    expect(formula.sourceRanges[1]!.start.charOffset).toBeGreaterThan(
      formula.sourceRanges[0]!.end.charOffset,
    );
  });
  it('skips ruby pronunciation while retaining precise original offsets after it', () => {
    const parsed = sanitizeChapter(
      '<html><body><p>读<ruby>汉<rt>hàn</rt></ruby>字。再见。</p></body></html>',
      'text.xhtml',
      new Map(),
    );
    const input = chapter(parsed.paragraphs, parsed.nodes);
    const sentences = [...segmentChapter(input, 0)];
    expect(sentences.map((s) => s.text)).toEqual(['读汉 字。', '再见。']);
    expect(
      sentences[0]!.sourceRanges.map((r) => [
        r.start.charOffset,
        r.end.charOffset,
      ]),
    ).toEqual([
      [0, 2],
      [5, 7],
    ]);
    expect(sentences[1]!.start.charOffset).toBe(7);
    // A locator on the skipped ruby annotation never rewinds before that skip.
    expect(
      [
        ...segmentChapter(input, 0, 120, {
          chapterIndex: 0,
          paragraphIndex: 0,
          charOffset: 3,
        }),
      ][0]?.text,
    ).toBe('字。');
  });
  it('filters inherited exclusions and skips unreliable or duplicated paragraph mappings', () => {
    const input = chapter(
      ['正文', '表格内容', '不一致', '重复'],
      [
        { tag: 'p', paragraphIndex: 0, children: ['正文'] },
        {
          tag: 'div',
          kind: 'table',
          children: [{ tag: 'p', paragraphIndex: 1, children: ['表格内容'] }],
        },
        { tag: 'p', paragraphIndex: 2, children: ['原文不匹配'] },
        { tag: 'p', paragraphIndex: 3, children: ['重复'] },
        { tag: 'p', paragraphIndex: 3, children: ['重复'] },
      ],
    );
    const result = extractSpeech(input);
    expect(result.paragraphs.map((p) => p.text)).toEqual(['正文']);
    expect(result.skippedParagraphs).toBe(1);
    expect(result.unmappedParagraphs).toBe(2);
  });
  it('maps inserted separators without pointing at removed formula source', () => {
    const input = chapter(
      ['hello$x$world。'],
      [
        {
          tag: 'p',
          paragraphIndex: 0,
          children: [
            'hello',
            { tag: 'span', math: 'x', children: ['$x$'] },
            'world。',
          ],
        },
      ],
    );
    const sentence = [...segmentChapter(input, 0)][0]!;
    expect(sentence.text).toBe('hello world。');
    expect(
      sentence.sourceRanges.map((r) => [r.start.charOffset, r.end.charOffset]),
    ).toEqual([
      [0, 5],
      [8, 14],
    ]);
  });
  it('does not follow a footnote link or repeat its definition', () => {
    const parsed = parseMarkdown('正文[^a]结束。\n\n[^a]: 唯一注释。');
    const sentences = parsed.chapters.flatMap((p) => [
      ...segmentChapter({ ...p, bookId: 'notes' }, 0),
    ]);
    expect(sentences.filter((s) => s.text.includes('唯一注释'))).toHaveLength(
      1,
    );
  });
});
