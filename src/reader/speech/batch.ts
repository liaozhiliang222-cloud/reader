/**
 * 听书准备：从起读位置到全书末尾逐章抽取、组批、交给后端。
 * 批次遵守 128 KiB / 256 句上限，一次只发一个待确认批次；
 * 可取消；全书与队列不同时常驻内存。
 */
import { getChapter } from '@/db/repository';
import { chapterSentences, type ReadableSentence } from './extract';
import {
  BATCH_BYTES,
  BATCH_SENTENCES,
  type SpeechBatch,
  type SpeechBackend,
  type SpeechSentence,
} from './SpeechBackend';
import type { Book, Locator, StoredChapter } from '@/types';

export interface PrepareProgress {
  /** 已完成章节数与总章节数。 */
  done: number;
  total: number;
  sentences: number;
}

export interface PrepareOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PrepareProgress) => void;
  /** 「读完本章」只准备当前章时给出截止章节 index。 */
  untilChapter?: number;
  /**
   * 本段允许写入的会话字节预算（按批次 JSON 实测）。
   * 书很大时分段准备，播放段尾后由协调器续备下一段。
   */
  byteBudget?: number;
}

export interface PrepareResult {
  /** 写入后端的句子总数。 */
  total: number;
  /** 为 true 表示因预算打满提前收尾，书中还有未准备内容。 */
  hasMore: boolean;
  /** hasMore 时下一段的起读锚点（本段最后一句的句尾）。 */
  nextFrom?: Locator;
}

const textEncoder = new TextEncoder();
const byteLength = (value: string) => textEncoder.encode(value).length;
/** 默认段预算：给会话 64MiB 上限留 4MiB 批次封装与余量。 */
const DEFAULT_BYTE_BUDGET = 60 * 1024 * 1024;

function sentenceId(revision: number, sentence: ReadableSentence): string {
  const first = sentence.sourceRanges[0]!,
    last = sentence.sourceRanges.at(-1)!;
  return `r${revision}-c${sentence.chapterIndex}-p${first.paragraphIndex}:${first.start}-${last.paragraphIndex}:${last.end}`;
}

function toSpeech(
  revision: number,
  index: number,
  chapterTitle: string,
  sentence: ReadableSentence,
): SpeechSentence {
  return {
    index,
    id: sentenceId(revision, sentence),
    text: sentence.text,
    chapterIndex: sentence.chapterIndex,
    chapterTitle,
    start: sentence.start,
    end: sentence.end,
    sourceRanges: sentence.sourceRanges,
  };
}

/** 起读句：包含锚点或在其后的第一句（句尾在锚点之后的跳过）。 */
function fromAnchor(
  sentences: ReadableSentence[],
  anchor: Locator,
): ReadableSentence[] {
  return sentences.filter(
    (sentence) =>
      sentence.end.chapterIndex > anchor.chapterIndex ||
      (sentence.end.chapterIndex === anchor.chapterIndex &&
        (sentence.end.paragraphIndex > anchor.paragraphIndex ||
          (sentence.end.paragraphIndex === anchor.paragraphIndex &&
            sentence.end.charOffset > anchor.charOffset))),
  );
}

/**
 * 组批并逐批交给 backend。整段序列化体积受 byteBudget 限制
 * （低于原生会话 64MiB 上限）：写满即提前收尾，hasMore 标真、
 * nextFrom 指向已写入末句句尾，供协调器无缝续备下一段。
 * 没有可读内容时 total 为 0（由调用方提示，不标已读完）。
 */
export async function prepareSpeech(
  book: Book,
  backend: SpeechBackend,
  from: Locator,
  options: PrepareOptions = {},
): Promise<PrepareResult> {
  const revision = book.contentRevision ?? 0;
  const byteBudget = options.byteBudget ?? DEFAULT_BYTE_BUDGET;
  let segmentBytes = 0;
  const lastChapter =
    options.untilChapter !== undefined
      ? Math.min(options.untilChapter, book.chapterCount - 1)
      : book.chapterCount - 1;
  const total = Math.max(0, lastChapter - from.chapterIndex + 1);
  let index = 0,
    batchIndex = 0,
    done = 0,
    hasMore = false;
  let pending: SpeechSentence[] = [],
    bytes = 0,
    pendingCost = 0,
    nextFrom: Locator | undefined;
  const flush = async (final: boolean) => {
    if (!pending.length && !final) return;
    const batch: SpeechBatch = {
      batchIndex: batchIndex++,
      firstSentenceIndex: pending[0]?.index ?? index,
      sentences: pending,
      final,
    };
    await backend.append(batch);
    segmentBytes += byteLength(JSON.stringify(batch));
    pending = [];
    bytes = 0;
    pendingCost = 0;
  };
  outer: for (let c = from.chapterIndex; c <= lastChapter; c++) {
    options.signal?.throwIfAborted();
    const chapter: StoredChapter | undefined = await getChapter(book.id, c);
    options.signal?.throwIfAborted();
    // 空章/缺失章继续寻找后续可读内容。
    const sentences = chapter ? chapterSentences(chapter) : [];
    const scope =
      c === from.chapterIndex ? fromAnchor(sentences, from) : sentences;
    for (const sentence of scope) {
      const speech = toSpeech(
        revision,
        index,
        chapter?.title ?? `第 ${c + 1} 章`,
        sentence,
      );
      const size = byteLength(speech.text) + 128;
      const cost = byteLength(JSON.stringify(speech)) + 64;
      // 会话段预算打满：本段就此收尾，下一段从当前句继续。
      if (index > 0 && segmentBytes + pendingCost + cost > byteBudget) {
        hasMore = true;
        break outer;
      }
      if (
        pending.length &&
        (pending.length >= BATCH_SENTENCES || bytes + size > BATCH_BYTES)
      )
        await flush(false);
      pending.push(speech);
      bytes += size;
      pendingCost += cost;
      index++;
      nextFrom = sentence.end;
    }
    done++;
    options.onProgress?.({ done, total, sentences: index });
  }
  await flush(true);
  await backend.commit(index);
  return { total: index, hasMore, nextFrom };
}
