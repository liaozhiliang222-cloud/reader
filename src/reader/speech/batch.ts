import type { Locator, StoredChapter } from '@/types';
import { segmentChapter, type SpeechSentence } from './segment';
import {
  SPEECH_LIMITS,
  utf8Size,
  validIdentity,
  validLocator,
  type SpeechBatch,
  type SpeechIdentity,
} from './protocol';

export interface PrepareSpeechOptions {
  identity: SpeechIdentity;
  start: Locator;
  chapterCount: number;
  chapterOnly?: boolean;
  getChapter: (index: number) => Promise<StoredChapter>;
  assertRevision: () => Promise<void>;
  signal: AbortSignal;
  onProgress?: (finished: number, total: number) => void;
}

/** Backpressure is supplied by the async iterator: append/ACK one batch before next().
 * A caller must cancel native preparation on any exception and commit only on completion. */
export async function* prepareSpeech(
  options: PrepareSpeechOptions,
): AsyncGenerator<SpeechBatch> {
  const { identity, start, chapterCount, getChapter, assertRevision, signal } =
    options;
  if (
    !validIdentity(identity) ||
    !validLocator(start) ||
    !Number.isSafeInteger(chapterCount) ||
    chapterCount < 0 ||
    start.chapterIndex >= chapterCount
  )
    throw new Error('听书准备参数无效。');
  const lastChapter = options.chapterOnly
    ? start.chapterIndex + 1
    : chapterCount;
  const total = lastChapter - start.chapterIndex;
  const check = () => signal.throwIfAborted();
  let batchIndex = 0,
    firstSentenceIndex = 0,
    bytes = 0;
  let sentences: SpeechSentence[] = [];
  const message = (final: boolean): SpeechBatch => ({
    ...identity,
    batchIndex,
    firstSentenceIndex,
    sentences,
    final,
  });
  // JSON array brackets already belong to the empty envelope. Count each
  // sentence once, avoiding O(batch-size²) serialization on large books.
  let envelopeBytes = utf8Size(message(false));
  let sentenceBytes = 0;
  const account = (batch: SpeechBatch) => {
    const size = utf8Size(batch);
    if (
      size > SPEECH_LIMITS.batchBytes ||
      bytes + size > SPEECH_LIMITS.queueBytes
    )
      throw new Error('听书准备内容过大，请从较后的章节开始。');
    bytes += size;
    return batch;
  };
  for (let index = start.chapterIndex; index < lastChapter; index++) {
    check();
    await assertRevision();
    const chapter = await getChapter(index);
    check();
    if (chapter.bookId !== identity.bookId || chapter.index !== index)
      throw new Error('听书章节与书籍不一致，请重新打开书籍。');
    for (const sentence of segmentChapter(
      chapter,
      identity.contentRevision,
      SPEECH_LIMITS.sentenceUnits,
      start,
    )) {
      check();
      const addedBytes = utf8Size(sentence);
      if (
        sentences.length >= SPEECH_LIMITS.batchSentences ||
        envelopeBytes + sentenceBytes + addedBytes + sentences.length >
          SPEECH_LIMITS.batchBytes
      ) {
        if (!sentences.length) throw new Error('单句听书数据过大，无法准备。');
        yield account(message(false));
        check();
        firstSentenceIndex += sentences.length;
        batchIndex++;
        sentences = [];
        sentenceBytes = 0;
        envelopeBytes = utf8Size(message(false));
      }
      if (envelopeBytes + addedBytes > SPEECH_LIMITS.batchBytes)
        throw new Error('单句听书数据过大，无法准备。');
      sentences.push(sentence);
      sentenceBytes += addedBytes;
    }
    options.onProgress?.(index - start.chapterIndex + 1, total);
    // Yield to input/visibility handlers even for empty chapters or <1 batch books.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  check();
  await assertRevision();
  check();
  if (!sentences.length) throw new Error('此位置之后没有可朗读内容。');
  yield account(message(true));
}
