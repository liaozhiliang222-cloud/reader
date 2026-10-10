import { expect, it } from 'vitest';
import {
  chapterChunks,
  chunkForLocator,
  nodesForChunk,
  CHUNK_CHARS,
  CHUNK_PARAGRAPHS,
} from './chunks';
import {
  sanitizeChapter,
  textOf,
  type SafeNode,
} from '@/parsers/epub/sanitize';
import type { TextChapter } from '@/parsers/txt/chapters';

const chapter = (paragraphs: string[]): TextChapter => ({
  index: 0,
  title: '正文',
  paragraphs,
  charStart: 0,
  charCount: paragraphs.reduce((sum, text) => sum + text.length, 0),
});
function check(paragraphs: string[]) {
  const chunks = chapterChunks(chapter(paragraphs));
  const restored = paragraphs.map(() => '');
  chunks.forEach((chunk, index) => {
    expect(chunk.index).toBe(index);
    expect(chunk.paragraphs.length).toBeLessThanOrEqual(CHUNK_PARAGRAPHS);
    expect(
      chunk.paragraphs.reduce((size, span) => size + span.end - span.start, 0),
    ).toBeLessThanOrEqual(CHUNK_CHARS);
    for (const span of chunk.paragraphs) {
      expect(span.start).toBe(restored[span.paragraphIndex]!.length);
      restored[span.paragraphIndex] += paragraphs[span.paragraphIndex]!.slice(
        span.start,
        span.end,
      );
      if (span.start)
        expect(
          /[\uDC00-\uDFFF]/.test(paragraphs[span.paragraphIndex]![span.start]!),
        ).toBe(false);
    }
  });
  expect(restored).toEqual(paragraphs);
  return chunks;
}

it('切点不拆常规嵌套注音或代理对，所有原文与定位编号保留，树不变', () => {
  for (const prefix of [11995, 11999]) {
    const clean = sanitizeChapter(
      `<html><body><p>${'前'.repeat(prefix)}<ruby><em>😀静</em><rt>jìng</rt></ruby>${'尾'.repeat(60000)}</p></body></html>`,
      'c.xhtml',
      new Map(),
    );
    const original = structuredClone(clean.nodes);
    const chunks = chapterChunks({
      ...chapter(clean.paragraphs),
      nodes: clean.nodes,
    });
    const trees = chunks.map((chunk) =>
      nodesForChunk(clean.nodes, chunk, clean.paragraphs, chunks),
    );
    const groups: string[] = [];
    const collect = (node: SafeNode) => {
      if (typeof node === 'string') return;
      if (node.tag === 'ruby') groups.push(textOf(node));
      node.children.forEach(collect);
    };
    trees.flat().forEach(collect);
    expect(groups).toEqual(['😀静jìng']);
    expect(trees.flat().map(textOf).join('')).toBe(clean.paragraphs.join(''));
    expect(chunks[0]!.paragraphs[0]!.end).toBe(prefix);
    expect(
      chunkForLocator(chunks, { paragraphIndex: 0, charOffset: prefix }).index,
    ).toBe(1);
    expect(
      chunkForLocator(chunks, { paragraphIndex: 0, charOffset: prefix - 1 })
        .index,
    ).toBe(0);
    for (const chunk of chunks)
      expect(
        chunk.paragraphs.reduce((sum, span) => sum + span.end - span.start, 0),
      ).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(clean.nodes).toEqual(original);
  }
});

it('超大注音标签仍保持分块预算，原文逐字保留且不会无限循环', () => {
  const clean = sanitizeChapter(
    `<html><body><p><ruby>${'长'.repeat(60000)}<rt>读音</rt></ruby>末尾</p></body></html>`,
    'c.xhtml',
    new Map(),
  );
  const chunks = chapterChunks({
    ...chapter(clean.paragraphs),
    nodes: clean.nodes,
  });
  expect(chunks).toHaveLength(6);
  expect(
    chunks
      .flatMap((chunk) =>
        nodesForChunk(clean.nodes, chunk, clean.paragraphs, chunks),
      )
      .map(textOf)
      .join(''),
  ).toBe(clean.paragraphs[0]);
  expect(
    chunks.every(
      (chunk) =>
        chunk.paragraphs.reduce(
          (sum, span) => sum + span.end - span.start,
          0,
        ) <= CHUNK_CHARS,
    ),
  ).toBe(true);
});

it('嵌套的多个注音组以完整外层归属一个块，不能被内层范围改变切点', () => {
  const clean = sanitizeChapter(
    `<html><body><p>${'前'.repeat(11994)}<ruby>始<ruby>静<rt>j</rt></ruby>中<ruby>页<rt>y</rt></ruby>终</ruby>${'尾'.repeat(60000)}</p></body></html>`,
    'c.xhtml',
    new Map(),
  );
  const chunks = chapterChunks({
    ...chapter(clean.paragraphs),
    nodes: clean.nodes,
  });
  expect(chunks[0]!.paragraphs[0]!.end).toBe(11994);
  const tree = nodesForChunk(clean.nodes, chunks[1]!, clean.paragraphs, chunks);
  const groups: string[] = [];
  const collect = (node: SafeNode) => {
    if (typeof node === 'string') return;
    if (node.tag === 'ruby') groups.push(textOf(node));
    node.children.forEach(collect);
  };
  tree.forEach(collect);
  expect(groups).toEqual(['始静j中页y终', '静j', '页y']);
  expect(
    chunks
      .flatMap((chunk) =>
        nodesForChunk(clean.nodes, chunk, clean.paragraphs, chunks),
      )
      .map(textOf)
      .join(''),
  ).toBe(clean.paragraphs[0]);
});
it('普通章节维持单块；空章节仍有可显示块', () => {
  expect(chapterChunks(chapter(['甲', '乙']))).toEqual([
    {
      index: 0,
      paragraphs: [
        { paragraphIndex: 0, start: 0, end: 1 },
        { paragraphIndex: 1, start: 0, end: 1 },
      ],
    },
  ]);
  expect(chapterChunks(chapter([]))).toEqual([{ index: 0, paragraphs: [] }]);
});
it('12万字单段和1000短段逐字无损，块大小有界且不拆代理对', () => {
  const chunks = check(['甲'.repeat(11999) + '😀' + '乙'.repeat(108000)]);
  expect(chunks[0]!.paragraphs[0]!.end).toBe(11999);
  check(
    Array.from({ length: 1000 }, (_, index) =>
      index % 7 === 0 ? '' : '第' + index + '段'.repeat(140),
    ),
  );
  const short = check(Array.from({ length: 1000 }, () => '甲'));
  expect(short).toHaveLength(8);
});
it('恢复锚点按原段落UTF-16偏移查找，边界属于下一块，末尾属于末块', () => {
  const chunks = check(['甲'.repeat(60001), '尾']);
  expect(
    chunkForLocator(chunks, { paragraphIndex: 0, charOffset: 11999 }).index,
  ).toBe(0);
  expect(
    chunkForLocator(chunks, { paragraphIndex: 0, charOffset: 12000 }).index,
  ).toBe(1);
  expect(
    chunkForLocator(chunks, { paragraphIndex: 0, charOffset: 40000 }).index,
  ).toBe(3);
  expect(
    chunkForLocator(chunks, { paragraphIndex: 1, charOffset: 1 }).index,
  ).toBe(chunks.length - 1);
});
it('EPUB分块保留列表、强调、注音和图片，空段及边界图仅归属一次，原树不变', () => {
  const clean = sanitizeChapter(
    `<html><body><ul><li><p align="center"><strong>${'甲'.repeat(12000)}</strong><img src="a.png"/><ruby>😀<rt>读音</rt></ruby>${'乙'.repeat(48000)}</p></li><li><p><img src="b.png"/></p></li></ul><hr/></body></html>`,
    'chapter.xhtml',
    new Map([
      ['a.png', 'a'],
      ['b.png', 'b'],
    ]),
  );
  const original = structuredClone(clean.nodes),
    chunks = chapterChunks(chapter(clean.paragraphs));
  const trees = chunks.map((chunk) =>
    nodesForChunk(clean.nodes, chunk, clean.paragraphs, chunks),
  );
  expect(trees.flat().map(textOf).join('')).toBe(
    clean.nodes.map(textOf).join(''),
  );
  const images: { id: string; chunk: number }[] = [];
  const collect = (node: SafeNode, chunk: number) => {
    if (typeof node === 'string') return;
    if (node.imageId) images.push({ id: node.imageId, chunk });
    node.children.forEach((child) => collect(child, chunk));
  };
  trees.forEach((tree, index) => tree.forEach((node) => collect(node, index)));
  expect(images).toEqual([
    { id: 'a', chunk: 1 },
    { id: 'b', chunk: chunks.length - 1 },
  ]);
  expect(JSON.stringify(trees)).toContain('ruby');
  expect(JSON.stringify(trees)).toContain('center');
  expect(clean.nodes).toEqual(original);
});
