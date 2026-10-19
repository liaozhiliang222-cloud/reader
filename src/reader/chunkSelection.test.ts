// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { HighlightLayer } from './highlight';
import { rangeForSpan, spanFromRange } from './selection';
import type { Highlight } from '@/types';

afterEach(() => document.body.replaceChildren());

it('旧跨块跨段划线在新的注音边界只画当前交集，mark保留注音树和UTF-16选区', () => {
  const root = document.createElement('div');
  root.dataset.chunked = 'true';
  root.innerHTML =
    '<p data-p="0" data-char-start="11999"><ruby><em>静</em>页<rt>jìngyè</rt></ruby>尾段。</p><p data-p="1">跨段后续😀文本。</p>';
  document.body.append(root);
  const paragraphs = [
    '前'.repeat(11999) + '静页jìngyè尾段。',
    '跨段后续😀文本。',
  ];
  const annotation: Highlight = {
    id: 'old-cross',
    bookId: 'original',
    chapterIndex: 0,
    start: { paragraphIndex: 0, charOffset: 11995 },
    end: { paragraphIndex: 1, charOffset: 6 },
    text: '前前前前静页jìngyè尾段。\n跨段后续😀',
    color: 'blue',
    createdAt: 1,
    updatedAt: 1,
  };
  const unchanged = structuredClone(annotation),
    before = root.innerHTML;
  const expected = '静页jìngyè尾段。跨段后续😀';
  expect(rangeForSpan(root, annotation)?.toString()).toBe(expected);
  const layer = new HighlightLayer(false);
  layer.render([{ root, chapter: { index: 0 } }], [annotation]);
  expect(
    [...root.querySelectorAll('mark')].map((mark) => mark.textContent).join(''),
  ).toBe(expected);
  expect(root.querySelector('ruby rt mark')?.textContent).toBe('jìngyè');
  expect(root.querySelector('ruby em mark')?.textContent).toBe('静');
  const range = rangeForSpan(root, annotation)!;
  expect(spanFromRange(root, 0, paragraphs, range)).toMatchObject({
    start: { paragraphIndex: 0, charOffset: 11999 },
    end: { paragraphIndex: 1, charOffset: 6 },
    text: '静页jìngyè尾段。\n跨段后续😀',
  });
  expect(annotation).toEqual(unchanged);
  layer.dispose();
  expect(root.innerHTML).toBe(before);
});
it('片段选区往返使用原文偏移；跨块划线只渲染当前交集，撤销保持行内结构', () => {
  const root = document.createElement('div');
  root.dataset.chunked = 'true';
  root.innerHTML =
    '<p data-p="0" data-char-start="12000"><strong>甲😀</strong><em>乙丙</em></p><p data-p="1">丁戊</p>';
  document.body.append(root);
  const paragraphs = ['前'.repeat(12000) + '甲😀乙丙后', '丁戊'];
  const range = document.createRange();
  range.setStart(root.querySelector('strong')!.firstChild!, 1);
  range.setEnd(root.querySelector('em')!.firstChild!, 1);
  const span = spanFromRange(root, 4, paragraphs, range)!;
  expect(span).toMatchObject({
    chapterIndex: 4,
    start: { paragraphIndex: 0, charOffset: 12001 },
    end: { paragraphIndex: 0, charOffset: 12004 },
    text: '😀乙',
  });
  expect(rangeForSpan(root, span)?.toString()).toBe('😀乙');
  const annotation: Highlight = {
    id: 'cross',
    bookId: 'test',
    chapterIndex: 4,
    start: { paragraphIndex: 0, charOffset: 11990 },
    end: { paragraphIndex: 1, charOffset: 1 },
    text: '',
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
  };
  expect(rangeForSpan(root, annotation)?.toString()).toBe('甲😀乙丙丁');
  const layer = new HighlightLayer(false),
    original = root.innerHTML;
  layer.render([{ root, chapter: { index: 4 } }], [annotation]);
  expect(
    [...root.querySelectorAll('mark')].map((mark) => mark.textContent).join(''),
  ).toBe('甲😀乙丙丁');
  expect(root.querySelector('strong mark')).not.toBeNull();
  layer.dispose();
  expect(root.innerHTML).toBe(original);
  expect(
    rangeForSpan(root, {
      ...annotation,
      end: { paragraphIndex: 0, charOffset: 11999 },
    }),
  ).toBeUndefined();
});
