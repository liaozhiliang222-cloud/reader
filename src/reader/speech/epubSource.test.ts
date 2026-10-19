import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { sanitizeChapter } from '@/parsers/epub/sanitize';
import { parseEpub } from '@/parsers/epub/parse';
import { speechChapterFromXhtml, openEpubSpeechSource } from './epubSource';
import { segmentChapter } from './segment';

it.each([1, 2, 3] as const)(
  'recovers lost table/code/ruby semantics for EPUB parser v%i without moving persisted text',
  (version) => {
    const source =
      '<html><body><p>开头😀。</p><table><tr><td>表格甲</td><td>表格乙</td></tr></table><pre>code_sample()</pre><p>读<ruby>汉<rt>hàn</rt></ruby>字，行内<code>secret</code>之后。</p><p>结尾。</p></body></html>';
    const sanitized = sanitizeChapter(source, 'a.xhtml', new Map(), version);
    const stored = {
      ...sanitized,
      bookId: 'epub',
      index: 0,
      title: '原创',
      charStart: 0,
      charCount: 0,
    };
    const before = JSON.stringify(stored);
    const mapped = speechChapterFromXhtml(
      source,
      'a.xhtml',
      stored,
      version,
      new Map(),
    );
    expect(JSON.stringify(stored)).toBe(before);
    expect(mapped.paragraphs).toEqual(stored.paragraphs);
    const sentences = [...segmentChapter(mapped, 0)];
    const spoken = sentences.map((s) => s.text).join('');
    expect(spoken).toContain('开头😀。');
    expect(spoken).toContain('结尾。');
    for (const skipped of ['表格', 'sample', 'hàn', 'secret'])
      expect(spoken).not.toContain(skipped);
    for (const sentence of sentences)
      for (const range of sentence.sourceRanges) {
        const value = stored.paragraphs[range.start.paragraphIndex]!.slice(
          range.start.charOffset,
          range.end.charOffset,
        );
        for (const skipped of ['表格', 'sample', 'hàn', 'secret'])
          expect(value).not.toContain(skipped);
      }
  },
);
it('does not confuse an existing private-use character with a filter marker', () => {
  const source =
    '<html><body><p>正文\ue000。</p><pre>不能读</pre></body></html>';
  const sanitized = sanitizeChapter(source, 'a.xhtml', new Map());
  const stored = {
    ...sanitized,
    bookId: 'book',
    index: 0,
    title: '章',
    charStart: 0,
    charCount: 0,
  };
  expect(
    [
      ...segmentChapter(
        speechChapterFromXhtml(source, 'a.xhtml', stored, 3, new Map()),
        0,
      ),
    ].map((s) => s.text),
  ).toEqual(['正文\ue000。']);
});
it('refuses a changed source instead of guessing offsets or reading unfiltered content', () => {
  const source = '<html><body><p>原文。</p></body></html>';
  const sanitized = sanitizeChapter(source, 'a.xhtml', new Map());
  const stored = {
    ...sanitized,
    paragraphs: ['改过的正文。'],
    bookId: 'book',
    index: 0,
    title: '章',
    charStart: 0,
    charCount: 0,
  };
  expect(() =>
    speechChapterFromXhtml(source, 'a.xhtml', stored, 3, new Map()),
  ).toThrow('不一致');
});
it('reads requested chapters from the original ZIP, retaining standalone image/SVG paragraph positions', async () => {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  );
  zip.file(
    'book.opf',
    '<package><manifest><item id="a" href="a.xhtml"/><item id="img" href="img.png" media-type="image/png"/></manifest><spine><itemref idref="a"/></spine></package>',
  );
  zip.file('img.png', new Uint8Array([137, 80, 78, 71]));
  zip.file(
    'a.xhtml',
    '<html><body><p>开始。</p><img src="img.png"/><svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1">图中文字</text></svg><table><tr><td>跳过</td></tr></table><p>结束。</p></body></html>',
  );
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const book = await parseEpub(bytes, 'book');
  const source = await openEpubSpeechSource(
    new Blob([bytes]),
    3,
    new AbortController().signal,
  );
  const stored = { ...book.chapters[0]!, bookId: 'book' };
  const mapped = await source(stored);
  expect(mapped.paragraphs).toEqual(stored.paragraphs);
  expect([...segmentChapter(mapped, 0)].map((s) => s.text)).toEqual([
    '开始。',
    '结束。',
  ]);
  const abort = new AbortController();
  abort.abort();
  await expect(
    openEpubSpeechSource(new Blob([bytes]), 3, abort.signal),
  ).rejects.toThrow();
});
