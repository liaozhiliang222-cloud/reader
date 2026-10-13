import { expect, it, vi } from 'vitest';
import type { StoredChapter } from '@/types';
import { prepareSpeech, type PrepareSpeechOptions } from './batch';
import { SPEECH_LIMITS, utf8Size } from './protocol';

const identity = {
  protocolVersion: 1,
  sessionId: 'test-session',
  bookId: 'test-book',
  contentRevision: 7,
  generation: 0,
} as const;
function options(paragraphs: string[][]): PrepareSpeechOptions {
  return {
    identity,
    start: { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 },
    chapterCount: paragraphs.length,
    signal: new AbortController().signal,
    assertRevision: vi.fn(async () => {}),
    getChapter: vi.fn(async (index): Promise<StoredChapter> => ({
      index,
      bookId: identity.bookId,
      title: `第${index + 1}章`,
      paragraphs: paragraphs[index]!,
      charStart: 0,
      charCount: 0,
    })),
  };
}
async function collect(input: PrepareSpeechOptions) {
  const batches = [];
  for await (const batch of prepareSpeech(input)) batches.push(batch);
  return batches;
}
it('streams complete, consecutive batches across empty chapters with a single final marker', async () => {
  const input = options([['第一章。'.repeat(280)], [], ['结束。'.repeat(280)]]);
  const progress = vi.fn();
  input.onProgress = progress;
  const batches = await collect(input);
  expect(batches.length).toBeGreaterThan(2);
  expect(batches.filter((b) => b.final)).toHaveLength(1);
  expect(batches.at(-1)!.final).toBe(true);
  let count = 0;
  for (const [index, batch] of batches.entries()) {
    expect(batch.batchIndex).toBe(index);
    expect(batch.firstSentenceIndex).toBe(count);
    expect(batch.sentences.length).toBeLessThanOrEqual(
      SPEECH_LIMITS.batchSentences,
    );
    expect(utf8Size(batch)).toBeLessThanOrEqual(SPEECH_LIMITS.batchBytes);
    count += batch.sentences.length;
  }
  expect(count).toBe(560);
  expect(progress.mock.calls).toEqual([
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});
it('accounts for actual UTF-8 JSON bytes including metadata, escapes and source ranges', async () => {
  const input = options([
    Array.from({ length: 300 }, () => '😀'.repeat(59) + '。'),
  ]);
  const batches = await collect(input);
  expect(batches[0]!.sentences.length).toBeLessThan(256);
  expect(batches.every((b) => utf8Size(b) <= 128 * 1024)).toBe(true);
  expect(batches.flatMap((b) => b.sentences)).toHaveLength(300);
});
it('prepares a large short-sentence book without treating repeated wire metadata as disk usage', async () => {
  const input = options([['春雨。'.repeat(220000)]]);
  let bytes = 0,
    count = 0,
    finals = 0;
  for await (const batch of prepareSpeech(input)) {
    bytes += utf8Size(batch);
    count += batch.sentences.length;
    finals += Number(batch.final);
    expect(utf8Size(batch)).toBeLessThanOrEqual(SPEECH_LIMITS.batchBytes);
  }
  expect(bytes).toBeGreaterThan(SPEECH_LIMITS.queueBytes);
  expect(count).toBe(220000);
  expect(finals).toBe(1);
}, 20000);
it('does not read the next chapter until the caller acknowledges a yielded batch', async () => {
  const input = options([['正文。'.repeat(600)], ['下章。']]);
  const stream = prepareSpeech(input);
  expect(input.getChapter).not.toHaveBeenCalled();
  const first = await stream.next();
  expect(first.done).toBe(false);
  expect(input.getChapter).toHaveBeenCalledTimes(1);
  await stream.return(undefined);
  expect(input.getChapter).toHaveBeenCalledTimes(1);
});
it('cancels without finalizing and rejects stale revisions after asynchronous reads', async () => {
  const input = options([['正文。'.repeat(600)]]);
  const abort = new AbortController();
  input.signal = abort.signal;
  const stream = prepareSpeech(input);
  await stream.next();
  abort.abort();
  await expect(stream.next()).rejects.toThrow();
  const stale = options([['正文。']]);
  let calls = 0;
  stale.assertRevision = async () => {
    if (++calls > 1) throw new Error('changed');
  };
  await expect(collect(stale)).rejects.toThrow('changed');
});
it('starts at the containing sentence and chapter mode never reads later chapters', async () => {
  const input = options([['前句。当前句。'], ['不可读取。']]);
  input.start.charOffset = 4;
  input.chapterOnly = true;
  const batches = await collect(input);
  expect(batches.flatMap((b) => b.sentences).map((s) => s.text)).toEqual([
    '当前句。',
  ]);
  expect(input.getChapter).toHaveBeenCalledTimes(1);
});
it('rejects empty, wrong-book, excessive-single-message and invalid preparations', async () => {
  await expect(collect(options([[], ['。。。']]))).rejects.toThrow(
    '没有可朗读内容',
  );
  const wrong = options([['正文']]);
  wrong.getChapter = async (index) => ({
    ...(await options([['正文']]).getChapter(index)),
    bookId: 'different',
  });
  await expect(collect(wrong)).rejects.toThrow('不一致');
  const huge = options([['正文']]);
  const get = huge.getChapter;
  huge.getChapter = async (index) => ({
    ...(await get(index)),
    title: '字'.repeat(50000),
  });
  await expect(collect(huge)).rejects.toThrow('数据过大');
  const invalid = options([['正文']]);
  invalid.start.charOffset = NaN;
  await expect(collect(invalid)).rejects.toThrow('参数无效');
});
