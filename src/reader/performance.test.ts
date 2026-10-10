// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { db } from '@/db';
import * as repository from '@/db/repository';
import { splitChapters } from '@/parsers/txt/chapters';
import { ReaderEngine, type ReaderInfo } from './ReaderEngine';
import { VirtualShelf, SHELF_ROW_HEIGHT } from '@/pages/Bookshelf/VirtualShelf';
import { defaultReading } from '@/app/defaults';
import { thousandChapterText } from './performanceFixtures';
import type { Book, Locator } from '@/types';

vi.mock('./paginator', async (original) => ({
  ...(await original<typeof import('./paginator')>()),
  pageCount: () => 2,
}));
vi.mock('./locator', () => ({
  getLocator: (_root: HTMLElement, page: number, chapterIndex: number) => ({
    chapterIndex,
    paragraphIndex: 0,
    charOffset: page * 10,
  }),
  pageOf: (_root: HTMLElement, locator: Locator) =>
    Math.floor(locator.charOffset / 10),
}));
vi.mock('./idle', () => ({ onIdle: () => () => {} }));
let engine: ReaderEngine | undefined, shelfRoot: HTMLDivElement | undefined;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(async () => {
  engine?.dispose();
  engine = undefined;
  if (shelfRoot) await act(() => render(null, shelfRoot!));
  shelfRoot = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  await db.delete();
});
it('可复现模型基准：千章按需打开/百次翻页，以及百本书架元数据与DOM有界', async () => {
  const source = thousandChapterText(),
    bytes = new TextEncoder().encode(source).length;
  let start = performance.now();
  const chapters = splitChapters(source),
    parseMs = performance.now() - start;
  expect(chapters).toHaveLength(1000);
  const book: Book = {
    id: 'performance',
    title: '静夜',
    type: 'txt',
    size: bytes,
    chapterCount: chapters.length,
    charCount: chapters.reduce((sum, c) => sum + c.charCount, 0),
    importedAt: 1,
    lastReadAt: 1,
  };
  await db.open();
  start = performance.now();
  await repository.saveBook(book, chapters, new Blob([source]));
  const importDbMs = performance.now() - start;
  const stored = (await repository.getBook(book.id))!;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const read = vi.spyOn(repository, 'getChapter'),
    frame = document.createElement('div'),
    host = document.createElement('div');
  Object.defineProperties(frame, {
    clientWidth: { value: 390 },
    clientHeight: { value: 844 },
  });
  document.body.append(frame);
  frame.append(host);
  let last: ReaderInfo | undefined,
    peakRoots = 0;
  const error = vi.fn();
  engine = new ReaderEngine(
    stored,
    frame,
    host,
    { ...defaultReading, pageAnimation: 'none' },
    (info) => {
      last = info;
      peakRoots = Math.max(peakRoots, host.childElementCount);
    },
    error,
    vi.fn(),
  );
  start = performance.now();
  await engine.start(
    Promise.resolve({ chapterIndex: 500, paragraphIndex: 0, charOffset: 10 }),
  );
  const openMs = performance.now() - start;
  await vi.waitFor(() => expect(host.childElementCount).toBe(3));
  const initialReads = read.mock.calls.length;
  expect(initialReads).toBe(3);
  start = performance.now();
  for (let index = 0; index < 100; index++) engine.turn(1);
  await vi.waitFor(() => expect(last?.chapterIndex).toBe(550));
  const turnsMs = performance.now() - start;
  await vi.waitFor(() => expect(host.childElementCount).toBe(3));
  expect(error).not.toHaveBeenCalled();
  expect(peakRoots).toBeLessThanOrEqual(3);
  expect(read.mock.calls.length).toBeLessThan(120);
  const chapterReads = read.mock.calls.length;
  engine.dispose();
  engine = undefined;
  frame.remove();
  const books: Book[] = Array.from({ length: 100 }, (_, index) => ({
    ...stored,
    id: 'shelf-' + index,
    title: '书架样本' + index,
  }));
  await db.books.delete(stored.id);
  await db.books.bulkPut(books);
  start = performance.now();
  const entries = await repository.listShelf(),
    shelfQueryMs = performance.now() - start;
  expect(entries).toHaveLength(100);
  expect(entries.every(({ book }) => !book.chapterSummaries && !book.toc)).toBe(
    true,
  );
  let scroll = 0;
  const bounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('virtual-shelf')
        ? new DOMRect(0, -scroll, 390, 100 * SHELF_ROW_HEIGHT)
        : bounds.call(this);
    },
  );
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
  shelfRoot = document.createElement('div');
  document.body.append(shelfRoot);
  start = performance.now();
  await act(() =>
    render(
      createElement(VirtualShelf, {
        entries,
        onRead: vi.fn(),
        onActions: vi.fn(),
      }),
      shelfRoot!,
    ),
  );
  const shelfRenderMs = performance.now() - start,
    firstRows = shelfRoot.querySelectorAll('li').length;
  expect(firstRows).toBeLessThanOrEqual(10);
  scroll = SHELF_ROW_HEIGHT * 95;
  window.dispatchEvent(new Event('scroll'));
  await vi.waitFor(() =>
    expect(shelfRoot!.querySelector('[data-shelf-index="99"]')).not.toBeNull(),
  );
  expect(shelfRoot.querySelectorAll('li').length).toBeLessThanOrEqual(12);
  const report = {
    recordedAt: new Date().toISOString(),
    environment: `Node ${process.version}; happy-dom; fake-indexeddb; 390×844; two-page geometry model`,
    limitation:
      'Not real browser layout, Worker transfer, device memory, FPS, or PRD timing acceptance. Historical M0-10 desktop import 362ms is a different path and cannot be compared as a speedup.',
    sourceBytes: bytes,
    chapters: 1000,
    shelfBooks: 100,
    parseMs,
    importDbMs,
    openMs,
    turns100Ms: turnsMs,
    shelfQueryMs,
    shelfRenderMs,
    initialChapterReads: initialReads,
    chapterReadsAfter100Turns: chapterReads,
    peakReadingRoots: peakRoots,
    firstShelfRows: firstRows,
    lastShelfRows: shelfRoot.querySelectorAll('li').length,
    retainedShelfChapterSummaries: 0,
  };
  console.info('静页性能模型基准', JSON.stringify(report));
  if (process.env.JINGYE_PERF_REPORT === '1') {
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/performance-model.json',
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}, 15000);
