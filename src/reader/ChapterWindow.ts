import { t } from '@/i18n';
export interface CachedChapter {
  release: () => void;
}

/** 只保留要求的章节；被淘汰的异步构建不能重新进入缓存。 */
export class ChapterWindow<T extends CachedChapter, Key = number> {
  private entries = new Map<
    Key,
    { controller: AbortController; value?: T; promise: Promise<T> }
  >();
  private disposed = false;
  constructor(
    private create: (index: Key, signal: AbortSignal) => Promise<T>,
  ) {}
  get(index: Key): Promise<T> {
    if (this.disposed) return Promise.reject(new Error(t('阅读器已关闭。')));
    const old = this.entries.get(index);
    if (old) return old.promise;
    const controller = new AbortController();
    const entry: {
      controller: AbortController;
      value?: T;
      promise: Promise<T>;
    } = {
      controller,
      promise: Promise.resolve()
        .then(() => this.create(index, controller.signal))
        .then((value) => {
          if (this.disposed || controller.signal.aborted) {
            value.release();
            throw new Error(t('章节预排版已取消。'));
          }
          entry.value = value;
          return value;
        })
        .catch((error) => {
          if (this.entries.get(index) === entry) this.entries.delete(index);
          throw error;
        }),
    };
    this.entries.set(index, entry);
    return entry.promise;
  }
  ready(index: Key): T | undefined {
    return this.entries.get(index)?.value;
  }
  values(): T[] {
    return Array.from(this.entries.values()).flatMap((entry) =>
      entry.value ? [entry.value] : [],
    );
  }
  retain(indices: Key[]) {
    const keep = new Set(indices);
    for (const [index, entry] of this.entries)
      if (!keep.has(index)) {
        this.entries.delete(index);
        entry.controller.abort();
        entry.value?.release();
      }
  }
  dispose() {
    this.disposed = true;
    this.retain([]);
  }
}
