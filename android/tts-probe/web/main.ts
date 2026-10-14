import { prepareSpeech } from '../../../src/reader/speech/batch';
import { utf8Size } from '../../../src/reader/speech/protocol';
import type { StoredChapter } from '../../../src/types';

declare global {
  interface Window {
    JyProbe: {
      begin(input: string): string;
      append(input: string): string;
      commit(count: number): string;
      finish(input: string): void;
    };
  }
}

const original = '清晨，窗外的树叶轻轻摇动。小路上洒满温暖的阳光。我们带着一本书出发，沿着河岸慢慢行走。远处传来鸟鸣，身边吹过微风。今天，我们一起聆听这段原创测试文字。';
let running = false;
const status = document.getElementById('status')!;
function invoke(value: string) {
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== 'object') throw new Error('invalid_result');
  const error: unknown = Reflect.get(result, 'error');
  if (typeof error === 'string') throw new Error(error);
}
function heapBytes(): number | null {
  const memory: unknown = Reflect.get(performance, 'memory');
  if (!memory || typeof memory !== 'object') return null;
  const bytes: unknown = Reflect.get(memory, 'usedJSHeapSize');
  return typeof bytes === 'number' ? bytes : null;
}

export async function run(characters: number, chapters: number) {
  if (running) return;
  running = true;
  const started = performance.now();
  let batches = 0, sentences = 0, bytes = 0, maxBatchBytes = 0;
  const initialHeap = heapBytes();
  let sampledPeakHeap = initialHeap;
  let error: string | null = null;
  const identity = {
    protocolVersion: 1 as const,
    sessionId: crypto.randomUUID(),
    bookId: '0'.repeat(64),
    contentRevision: 0,
    generation: 0,
  };
  status.textContent = '正在生成并写入完整队列…';
  try {
    invoke(window.JyProbe.begin(JSON.stringify(identity)));
    for await (const batch of prepareSpeech({
      identity,
      start: { chapterIndex: 0, paragraphIndex: 0, charOffset: 0 },
      chapterCount: chapters,
      assertRevision: async () => {},
      signal: new AbortController().signal,
      getChapter: async (index): Promise<StoredChapter> => {
        const start = Math.floor(index * characters / chapters);
        const size = Math.floor((index + 1) * characters / chapters) - start;
        return {
          bookId: identity.bookId,
          index,
          title: `第 ${index + 1} 章 原创测试`,
          charStart: start,
          charCount: size,
          paragraphs: [original.repeat(Math.ceil(size / original.length)).slice(0, size)],
        };
      },
      onProgress: (done, total) => { status.textContent = `已准备 ${done}/${total} 章`; },
    })) {
      invoke(window.JyProbe.append(JSON.stringify(batch)));
      const size = utf8Size(batch);
      bytes += size;
      maxBatchBytes = Math.max(maxBatchBytes, size);
      batches++;
      sentences += batch.sentences.length;
      const heap = heapBytes();
      if (heap !== null) sampledPeakHeap = Math.max(sampledPeakHeap ?? 0, heap);
      // The actual bridge ACK is the backpressure boundary; yield for rendering.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    invoke(window.JyProbe.commit(sentences));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'unknown';
  }
  const result = {
    characters, chapters, batches, sentences, bytes, maxBatchBytes,
    durationMs: performance.now() - started,
    jsInitialHeapBytes: initialHeap, jsSampledPeakHeapBytes: sampledPeakHeap,
    userAgent: navigator.userAgent, error,
    note: 'Original fixture; real WebView JS-to-Java bridge and queue fsync; not Capacitor/IndexedDB extraction. Heap is sampled, not guaranteed absolute peak.',
  };
  window.JyProbe.finish(JSON.stringify(result));
  status.textContent = JSON.stringify(result, null, 2);
  running = false;
}
