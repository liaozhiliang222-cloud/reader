import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, StoredChapter } from '@/types';
import type { SpeechBatch, SpeechBackend } from './SpeechBackend';
import { prepareSpeech } from './batch';

vi.mock('@/db/repository', () => ({ getChapter: vi.fn() }));
import { getChapter } from '@/db/repository';

const chapters = new Map<number, StoredChapter>();
const chapterAt = (index: number, paragraphs: string[]): StoredChapter => ({
  index,
  title: `第${index}章`,
  paragraphs,
  bookId: 'b1',
  charStart: 0,
  charCount: paragraphs.join('').length,
});
const book = (chapterCount: number): Book =>
  ({ id: 'b1', chapterCount, contentRevision: 3 }) as Book;

class FakeBackend implements SpeechBackend {
  batches: SpeechBatch[] = [];
  committed = -1;
  async voices() {
    return [];
  }
  async begin() {}
  async append(batch: SpeechBatch) {
    this.batches.push(batch);
  }
  async commit(total: number) {
    this.committed = total;
  }
  async cancelPrepare() {}
  async command() {}
  async setRate() {}
  async setVoice() {}
  async setTimer() {}
  async snapshot() {
    return {} as never;
  }
  on() {
    return () => {};
  }
}

beforeEach(() => {
  chapters.clear();
  vi.mocked(getChapter).mockImplementation(
    ((_id: string, index: number) =>
      Promise.resolve(chapters.get(index))) as never,
  );
});

describe('听书准备组批', () => {
  it('从锚点起读：锚点前的句子不进入批次', async () => {
    chapters.set(0, chapterAt(0, ['甲。乙。丙。']));
    const backend = new FakeBackend();
    const total = await prepareSpeech(book(1), backend, {
      chapterIndex: 0,
      paragraphIndex: 0,
      charOffset: 2, // 在「乙。」中
    });
    expect(total).toBe(2);
    expect(backend.batches.at(-1)!.sentences.map((s) => s.text)).toEqual([
      '乙。',
      '丙。',
    ]);
    expect(backend.batches.at(-1)!.final).toBe(true);
    expect(backend.committed).toBe(2);
  });

  it('空章与缺失章跳过，后续章节继续', async () => {
    chapters.set(0, chapterAt(0, ['   ']));
    chapters.set(2, chapterAt(2, ['好。']));
    const backend = new FakeBackend();
    const total = await prepareSpeech(book(3), backend, {
      chapterIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
    expect(total).toBe(1);
    expect(backend.batches.at(-1)!.sentences[0]!.chapterIndex).toBe(2);
  });

  it('整本无可读内容返回 0', async () => {
    chapters.set(0, chapterAt(0, ['   ']));
    const backend = new FakeBackend();
    expect(
      await prepareSpeech(book(1), backend, {
        chapterIndex: 0,
        paragraphIndex: 0,
        charOffset: 0,
      }),
    ).toBe(0);
  });

  it('超过 256 句拆批且批次连续、第一句索引衔接', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `句${i}。`);
    chapters.set(0, chapterAt(0, many));
    const backend = new FakeBackend();
    const total = await prepareSpeech(book(1), backend, {
      chapterIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
    expect(total).toBe(300);
    expect(backend.batches.length).toBe(2);
    expect(backend.batches[0]!.sentences).toHaveLength(256);
    expect(backend.batches[1]!.firstSentenceIndex).toBe(256);
    expect(backend.batches[0]!.final).toBe(false);
    expect(backend.batches[1]!.final).toBe(true);
  });

  it('跨章合并进同一批次', async () => {
    chapters.set(0, chapterAt(0, ['甲。']));
    chapters.set(1, chapterAt(1, ['乙。']));
    const backend = new FakeBackend();
    await prepareSpeech(book(2), backend, {
      chapterIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
    expect(backend.batches).toHaveLength(1);
    expect(
      backend.batches[0]!.sentences.map((s) => s.chapterIndex),
    ).toEqual([0, 1]);
  });

  it('取消时抛出且不发 commit', async () => {
    chapters.set(0, chapterAt(0, ['甲。']));
    chapters.set(1, chapterAt(1, ['乙。']));
    const controller = new AbortController();
    const backend = new FakeBackend();
    const promise = prepareSpeech(
      book(2),
      backend,
      { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(backend.committed).toBe(-1);
  });
});
