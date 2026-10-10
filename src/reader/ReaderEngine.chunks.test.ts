// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { ReaderEngine, type ReaderInfo } from './ReaderEngine';
import { getChapter } from '@/db/repository';
import { defaultReading } from '@/app/defaults';
import type { Book, Bookmark, Locator, StoredChapter } from '@/types';

// 每6000字符一页的几何模型，只验证调度和定位，不测量CSS分页。
vi.mock('./paginator', async (original) => ({
  ...(await original<typeof import('./paginator')>()),
  pageCount: (width: number) => Math.max(1, Math.ceil(width / 6000)),
}));
vi.mock('./locator', () => ({
  getLocator: (root: HTMLElement, page: number, chapterIndex: number) => {
    const p = root.querySelector<HTMLElement>('[data-p]')!;
    return {
      chapterIndex,
      paragraphIndex: Number(p.dataset.p),
      charOffset: Number(p.dataset.charStart ?? 0) + page * 6000,
    };
  },
  pageOf: (root: HTMLElement, locator: Locator) =>
    Math.max(
      0,
      Math.floor(
        (locator.charOffset -
          Number(
            root.querySelector<HTMLElement>('[data-p]')?.dataset.charStart ?? 0,
          )) /
          6000,
      ),
    ),
}));
const idle = vi.hoisted(() => new Set<() => void>());
vi.mock('./idle', () => ({
  onIdle: (work: () => void) => {
    idle.add(work);
    return () => idle.delete(work);
  },
}));
vi.mock('@/db/repository', () => ({ getChapter: vi.fn() }));
const book: Book = {
  id: 'long',
  title: '大书',
  type: 'txt',
  size: 360003,
  chapterCount: 1,
  charCount: 120001,
  importedAt: 1,
  lastReadAt: 1,
};
const chapter: StoredChapter = {
  bookId: book.id,
  index: 0,
  title: '长章',
  paragraphs: ['甲'.repeat(120001)],
  charStart: 0,
  charCount: 120001,
};
let engine: ReaderEngine;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  engine?.dispose();
  idle.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
});
function fixture() {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.querySelector('[data-p]')?.textContent?.length ?? 0;
    },
  );
  vi.mocked(getChapter)
    .mockReset()
    .mockImplementation(() => Dexie.Promise.resolve(chapter));
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const host = document.createElement('div'),
    frame = document.createElement('div');
  Object.defineProperties(frame, {
    clientWidth: { value: 390 },
    clientHeight: { value: 844 },
  });
  frame.append(host);
  document.body.append(frame);
  const updates: ReaderInfo[] = [],
    error = vi.fn();
  engine = new ReaderEngine(
    book,
    frame,
    host,
    { ...defaultReading, pageAnimation: 'none' },
    (value) => updates.push(value),
    error,
    vi.fn(),
  );
  return { host, updates, error };
}
async function settled() {
  for (let index = 0; index < 40; index++) await Promise.resolve();
}
async function measureAll() {
  for (let index = 0; index < 20 && idle.size; index++) {
    const work = [...idle][0]!;
    idle.delete(work);
    work();
    await settled();
  }
}
it('长段落续读只渲染当前与相邻块；跨块正反翻页、缩放、书签及百分比保持原锚点', async () => {
  const f = fixture();
  await engine.start(
    Promise.resolve({ chapterIndex: 0, paragraphIndex: 0, charOffset: 40000 }),
  );
  await settled();
  expect(f.host.childElementCount).toBe(3);
  expect(
    [...f.host.children].map((node) => node.getAttribute('data-chunk')).sort(),
  ).toEqual(['2', '3', '4']);
  expect(vi.mocked(getChapter)).toHaveBeenCalledOnce();
  for (const root of f.host.children)
    expect(
      root.querySelector('[data-p]')!.textContent!.length,
    ).toBeLessThanOrEqual(12000);
  expect(f.updates.at(-1)).toMatchObject({
    paginationReady: false,
    locator: { charOffset: 40000 },
  });
  const bookmark = (offset: number): Bookmark => ({
    id: String(offset),
    bookId: book.id,
    locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: offset },
    excerpt: '',
    chapterTitle: '',
    createdAt: 1,
  });
  expect(
    engine.bookmarksOnPage([bookmark(40000), bookmark(28000)]).map((b) => b.id),
  ).toEqual(['40000']);
  engine.configure({ ...defaultReading, fontSize: 28, pageAnimation: 'none' });
  expect(engine.currentLocator?.charOffset).toBe(40000);
  engine.turn(1);
  engine.turn(1);
  await settled();
  expect(engine.currentLocator?.charOffset).toBe(48000);
  engine.turn(-1);
  await settled();
  expect(engine.currentLocator?.charOffset).toBe(42000);
  engine.jumpPercent(75, [chapter]);
  await settled();
  expect(engine.currentLocator?.charOffset).toBe(90000);
  await measureAll();
  expect(f.updates.at(-1)).toMatchObject({
    paginationReady: true,
    pages: 21,
    locator: { charOffset: 90000 },
  });
  expect(f.host.childElementCount).toBeLessThanOrEqual(3);
  expect(f.error).not.toHaveBeenCalled();
});
it('后台某块排版失败后跳过，不反复重试；重新排版可重新测量', async () => {
  const f = fixture();
  let failures = 0;
  await engine.start(
    Promise.resolve({ chapterIndex: 0, paragraphIndex: 0, charOffset: 40000 }),
  );
  await settled();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      get ready() {
        if (f.host.lastElementChild?.getAttribute('data-chunk') === '0') {
          failures++;
          return Promise.reject(new Error('字体排版失败'));
        }
        return Promise.resolve();
      },
    },
  });
  await measureAll();
  expect(failures).toBe(1);
  expect(idle.size).toBe(0);
  expect(f.host.childElementCount).toBeLessThanOrEqual(3);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  engine.configure({ ...defaultReading, pageAnimation: 'none' });
  await measureAll();
  expect(f.updates.at(-1)?.paginationReady).toBe(true);
  expect(f.error).not.toHaveBeenCalled();
});
it('排版期间关闭立即移除DOM，晚到字体任务不能显示、更新或补排正文', async () => {
  const f = fixture();
  let complete!: () => void;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        complete = resolve;
      }),
    },
  });
  const start = engine.start(Promise.resolve(undefined));
  await settled();
  expect(f.host.childElementCount).toBe(1);
  engine.dispose();
  expect(f.host.childElementCount).toBe(0);
  complete();
  await start;
  await settled();
  expect(f.host.childElementCount).toBe(0);
  expect(f.updates).toHaveLength(0);
  expect(idle.size).toBe(0);
  expect(f.error).not.toHaveBeenCalled();
});

it('切到后台取消空闲排版，返回前台继续；关闭后移除可见性监听', async () => {
  fixture();
  await engine.start(
    Promise.resolve({ chapterIndex: 0, paragraphIndex: 0, charOffset: 40000 }),
  );
  await settled();
  let visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  expect(idle.size).toBe(1);
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  expect(idle.size).toBe(0);
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  expect(idle.size).toBe(1);
  engine.dispose();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(idle.size).toBe(0);
});
