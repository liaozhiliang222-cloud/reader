// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderEngine, type ReaderInfo } from './ReaderEngine';
import { defaultReading } from '@/app/defaults';
import { getChapter } from '@/db/repository';
import Dexie from 'dexie';
import type { StoredChapter, Book } from '@/types';

// Models the two-page geometry; this test does not measure real browser layout.
vi.mock('./paginator', async (original) => ({
  ...(await original<typeof import('./paginator')>()),
  pageCount: () => 2,
}));
vi.mock('./locator', () => ({
  getLocator: (_root: HTMLElement, page: number, chapterIndex: number) => ({
    chapterIndex,
    paragraphIndex: 0,
    charOffset: page * 5,
  }),
  pageOf: (_root: HTMLElement, locator: { charOffset: number }) =>
    Math.floor(locator.charOffset / 5),
}));
vi.mock('@/db/repository', () => ({ getChapter: vi.fn() }));
const book: Book = {
  id: 'model',
  title: '模型',
  type: 'txt',
  size: 20,
  chapterCount: 2,
  charCount: 20,
  importedAt: 1,
  lastReadAt: 1,
};
let engine: ReaderEngine | undefined;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  engine?.dispose();
  engine = undefined;
  document.body.replaceChildren();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  vi.restoreAllMocks();
});
function fixture() {
  vi.mocked(getChapter).mockImplementation((_id, index) =>
    Dexie.Promise.resolve(chapter(index)),
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const frame = document.createElement('div'),
    host = document.createElement('div');
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
    { ...defaultReading },
    (value) => updates.push(value),
    error,
    vi.fn(),
  );
  return { engine, host, updates, error };
}
function chapter(index: number): StoredChapter {
  return {
    bookId: book.id,
    index,
    title: '章节' + index,
    paragraphs: ['零一二三四五六七八九'],
    charStart: index * 10,
    charCount: 10,
  };
}
it('第一页/最后一页的拖动不能让正文永久偏移，跨章及快速连续翻页仍保存目标锚点', async () => {
  const f = fixture();
  await f.engine.start(Promise.resolve(undefined));
  let active = f.host.querySelector<HTMLElement>('[data-chapter="0"]')!;
  f.engine.drag(80);
  f.engine.turn(-1);
  expect(active.style.transform).toBe('translateX(0px)');
  expect(f.updates.at(-1)?.locator).toEqual({
    chapterIndex: 0,
    paragraphIndex: 0,
    charOffset: 0,
  });
  f.engine.turn(1);
  f.engine.turn(1);
  f.engine.turn(1);
  await vi.waitFor(() =>
    expect(f.updates.at(-1)).toMatchObject({
      chapterIndex: 1,
      page: 2,
      locator: { charOffset: 5 },
    }),
  );
  // 最后一章最后一页的锚点在页首，但进度应记为读完。
  expect(f.updates.at(-1)?.percent).toBe(100);
  f.engine.turn(-1);
  await vi.waitFor(() => expect(f.updates.at(-1)?.percent).toBe(50));
  f.engine.turn(1);
  await vi.waitFor(() => expect(f.updates.at(-1)?.percent).toBe(100));
  active = f.host.querySelector<HTMLElement>('[data-chapter="1"]')!;
  const position = active.style.transform;
  f.engine.drag(-80);
  f.engine.turn(1);
  expect(active.style.transform).toBe(position);
  expect(f.updates.at(-1)?.locator.charOffset).toBe(5);
  expect(f.error).not.toHaveBeenCalled();
});
it('章节加载失败归位到旧正文，停止队列；销毁后晚到的章节不能重新显示或保存位置', async () => {
  const f = fixture();
  let fail!: (error: Error) => void;
  vi.mocked(getChapter).mockImplementation((_id, index) =>
    index === 0
      ? Dexie.Promise.resolve(chapter(0))
      : new Dexie.Promise<StoredChapter>((_, reject) => {
          fail = reject;
        }),
  );
  await f.engine.start(Promise.resolve(undefined));
  await vi.waitFor(() => expect(fail).toBeDefined());
  f.engine.drag(80);
  f.engine.jump({ chapterIndex: 1, paragraphIndex: 0, charOffset: 0 });
  fail(new Error('章节读取失败'));
  await vi.waitFor(() =>
    expect(f.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: '章节读取失败' }),
    ),
  );
  expect(
    f.host.querySelector<HTMLElement>('[data-chapter="0"]')?.style.transform,
  ).toBe('translateX(0px)');
  expect(f.engine.currentLocator?.chapterIndex).toBe(0);
  let done!: (chapter: StoredChapter) => void;
  vi.mocked(getChapter).mockImplementation(
    () =>
      new Dexie.Promise<StoredChapter>((resolve) => {
        done = resolve;
      }),
  );
  f.engine.jump({ chapterIndex: 1, paragraphIndex: 0, charOffset: 0 });
  await vi.waitFor(() => expect(done).toBeDefined());
  f.engine.dispose();
  const count = f.updates.length;
  done(chapter(1));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.host.childElementCount).toBe(0);
  expect(f.updates.length).toBe(count);
});
