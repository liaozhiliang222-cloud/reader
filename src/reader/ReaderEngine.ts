import { getChapter } from '@/db/repository';
import { ChapterWindow } from './ChapterWindow';
import { renderNodes } from './content';
import { pageCount, pageGeometry } from './paginator';
import { getLocator, pageOf } from './locator';
import { currentSection } from './currentSection';
import { HighlightLayer } from './highlight';
import { rangeForSpan } from './selection';
import type { SourceRange } from './speech/segment';
import { PageMotion } from './PageMotion';
import {
  chapterChunks,
  chunkForLocator,
  inChunk,
  nodesForChunk,
  type ChapterChunk,
} from './chunks';
import { onIdle } from './idle';
import { contentLanguage } from './language';
import { beginMeasure } from '@/app/performance';
import { spanFromRange, visibleRangeRect } from './selection';
import {
  chapterAtPercent,
  clampLocator,
  locatorAtOffset,
  percentOf,
} from './position';
import type {
  Book,
  Bookmark,
  Highlight,
  ChapterSummary,
  Locator,
  ReadingSettings,
  StoredChapter,
} from '@/types';

export interface ReaderInfo {
  title: string;
  chapterIndex: number;
  page: number;
  pages: number;
  percent: number;
  locator: Locator;
  paginationReady?: boolean;
}
interface ChapterSource {
  chapter: StoredChapter;
  chunks: ChapterChunk[];
  release: () => void;
}
interface ChapterInstance {
  key: string;
  source: ChapterSource;
  chunk: ChapterChunk;
  chapter: StoredChapter;
  root: HTMLDivElement;
  pages: number;
  stride: number;
  release: () => void;
  finalized: boolean;
}
type Navigation =
  | { kind: 'turn'; direction: number }
  | { kind: 'jump'; locator: Locator; remember: boolean; highlightId?: string }
  | { kind: 'percent'; value: number; chapters: ChapterSummary[] };

export class ReaderEngine {
  private window: ChapterWindow<ChapterInstance, string>;
  private sources: ChapterWindow<ChapterSource>;
  private pageCounts = new Map<number, (number | undefined)[]>();
  private failedMeasurements = new Set<string>();
  private cancelIdle?: () => void;
  private measuring?: AbortController;
  private generation = 0;
  private active?: ChapterInstance;
  private page = 0;
  private anchor: Locator = {
    chapterIndex: 0,
    paragraphIndex: 0,
    charOffset: 0,
  };
  private running = true;
  private disposed = false;
  private queue: Navigation[] = [];
  private highlights: Highlight[] = [];
  private highlightLayer = new HighlightLayer();
  private speechRanges: SourceRange[] = [];
  private motion = new PageMotion();
  private visibilityChanged = () => {
    if (document.visibilityState === 'hidden') this.cancelMeasurement();
    else this.scheduleMeasurement();
  };
  constructor(
    private book: Book,
    private frame: HTMLElement,
    private host: HTMLElement,
    private reading: ReadingSettings,
    private onUpdate: (info: ReaderInfo) => void,
    private onError: (error: Error) => void,
    private onJump: (previous: Locator) => void,
    private beforeNavigate?: () => Promise<void>,
  ) {
    this.sources = new ChapterWindow(async (index, signal) => {
      const end = beginMeasure('章节读取与分块索引');
      try {
        const chapter = await getChapter(this.book.id, index);
        if (signal.aborted) throw new Error('章节预排版已取消。');
        if (!chapter) throw new Error('章节内容缺失。');
        return { chapter, chunks: chapterChunks(chapter), release: () => {} };
      } finally {
        end(!signal.aborted);
      }
    });
    this.window = new ChapterWindow((key, signal) => this.create(key, signal));
    document.addEventListener('visibilitychange', this.visibilityChanged);
  }
  get currentLocator(): Locator | undefined {
    return this.active ? { ...this.anchor } : undefined;
  }
  setHighlights(items: Highlight[]) {
    if (this.disposed) return;
    this.highlights = items.filter((item) => !item.unanchored);
    this.paintHighlights();
  }
  private paintHighlights() {
    if (!this.disposed) {
      this.highlightLayer.render(this.window.values(), this.highlights);
      this.paintSpeech();
    }
  }
  setSpeechRanges(ranges: SourceRange[]) {
    this.speechRanges = ranges;
    this.paintSpeech();
  }
  private paintSpeech() {
    const ranges: Range[] = [];
    if (this.active)
      for (const span of this.speechRanges) {
        if (span.start.chapterIndex !== this.active.chapter.index) continue;
        const range = rangeForSpan(this.active.root, {
          ...span,
          chapterIndex: span.start.chapterIndex,
        });
        if (range) ranges.push(range);
      }
    this.frame.querySelector('[data-speech-overlay]')?.remove();
    if (
      typeof CSS !== 'undefined' &&
      CSS.highlights &&
      typeof globalThis.Highlight !== 'undefined'
    ) {
      if (ranges.length) {
        const mark = new globalThis.Highlight(...ranges);
        mark.priority = -1;
        CSS.highlights.set('jingye-speech', mark);
      } else CSS.highlights.delete('jingye-speech');
    } else if (ranges.length) {
      const overlay = document.createElement('div');
      overlay.dataset.speechOverlay = '';
      overlay.setAttribute('aria-hidden', 'true');
      const frame = this.frame.getBoundingClientRect();
      for (const range of ranges)
        for (const rect of range.getClientRects()) {
          if (rect.right <= frame.left || rect.left >= frame.right) continue;
          const marker = document.createElement('i');
          marker.style.cssText = `left:${rect.left - frame.left}px;top:${rect.top - frame.top}px;width:${rect.width}px;height:${rect.height}px`;
          overlay.append(marker);
        }
      this.frame.append(overlay);
    }
  }
  selectedText() {
    const active = this.active,
      selection = window.getSelection();
    if (!active || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const span = spanFromRange(
      active.root,
      active.chapter.index,
      active.chapter.paragraphs,
      range,
    );
    const rect = visibleRangeRect(range, this.frame);
    return span && rect ? { ...span, rect } : undefined;
  }
  annotationAtPoint(x: number, y: number) {
    return this.active
      ? this.highlightLayer.atPoint(this.active.root, x, y, this.frame)
      : undefined;
  }
  jumpToHighlight(item: Highlight) {
    if (item.unanchored) return;
    this.queue.push({
      kind: 'jump',
      locator: { chapterIndex: item.chapterIndex, ...item.start },
      remember: true,
      highlightId: item.id,
    });
    void this.drain();
  }
  bookmarksOnPage(bookmarks: Bookmark[]) {
    const active = this.active;
    if (!active) return [];
    return bookmarks.filter(
      (bookmark) =>
        !bookmark.unanchored &&
        bookmark.locator.chapterIndex === active.chapter.index &&
        inChunk(active.chunk, bookmark.locator, active.source.chunks) &&
        pageOf(active.root, bookmark.locator, active.stride) === this.page,
    );
  }
  bookmarkData(): Omit<Bookmark, 'id' | 'createdAt'> | undefined {
    const active = this.active;
    if (!active) return;
    const locator = getLocator(
      active.root,
      this.page,
      active.chapter.index,
      active.stride,
    );
    let excerpt = '';
    for (
      let index = locator.paragraphIndex;
      index < active.chapter.paragraphs.length && excerpt.length < 100;
      index++
    ) {
      const text = active.chapter.paragraphs[index]!;
      excerpt +=
        (excerpt ? '\n' : '') +
        text.slice(
          index === locator.paragraphIndex ? locator.charOffset : 0,
          (index === locator.paragraphIndex ? locator.charOffset : 0) +
            100 -
            excerpt.length,
        );
    }
    return {
      bookId: this.book.id,
      locator,
      chapterTitle:
        currentSection(this.book.toc, locator)?.title ?? active.chapter.title,
      excerpt: [...excerpt].slice(0, 50).join(''),
    };
  }
  private layout(instance: ChapterInstance) {
    const margin = { narrow: 16, medium: 24, wide: 36 }[this.reading.margin];
    const g = pageGeometry(
      this.frame.clientWidth,
      this.frame.clientHeight,
      this.reading.fontSize,
      margin,
      this.reading.lineHeight,
      this.reading.showHeaderFooter ? 112 : 32,
    );
    const root = instance.root;
    Object.assign(root.style, {
      width: `${g.width}px`,
      height: `${g.height}px`,
      columnWidth: `${g.width}px`,
      columnGap: `${g.gap}px`,
      fontSize: `${this.reading.fontSize}px`,
      lineHeight: `${g.line}px`,
      marginLeft: `${margin}px`,
      marginTop: `${(this.frame.clientHeight - g.height) / 2}px`,
      textAlign: this.reading.align,
      fontFamily:
        this.reading.fontFamily === 'sans'
          ? 'var(--font-sans)'
          : this.reading.fontFamily === 'wenkai'
            ? 'JingyeWenkai, var(--font-serif)'
            : 'var(--font-serif)',
      transform: 'none',
    });
    root.style.setProperty(
      '--paragraph-spacing',
      `${this.reading.paragraphSpacing}em`,
    );
    root.style.setProperty(
      '--paragraph-indent',
      this.reading.indent ? '2em' : '0',
    );
    root.style.setProperty('--content-height', `${g.height}px`);
    root.style.setProperty('--line-height', `${g.line}px`);
    instance.stride = g.stride;
    instance.pages = pageCount(root.scrollWidth, g.stride);
    if (instance.finalized) {
      let counts = this.pageCounts.get(instance.chapter.index);
      if (!counts) {
        counts = Array.from(
          { length: instance.source.chunks.length },
          () => undefined,
        );
        this.pageCounts.set(instance.chapter.index, counts);
      }
      counts[instance.chunk.index] = instance.pages;
    }
  }
  configure(reading: ReadingSettings) {
    if (this.disposed) return;
    this.motion.cancel();
    this.cancelMeasurement();
    this.pageCounts.clear();
    this.failedMeasurements.clear();
    this.reading = { ...reading };
    for (const instance of this.window.values()) this.layout(instance);
    if (this.active) {
      this.page = Math.min(
        this.active.pages - 1,
        pageOf(this.active.root, this.anchor, this.active.stride),
      );
      this.update(this.anchor);
    }
    this.scheduleMeasurement();
  }
  private async create(
    key: string,
    signal: AbortSignal,
  ): Promise<ChapterInstance> {
    const [index = 0, part = 0] = key.split(':').map(Number);
    const source = await this.sources.get(index);
    const chapter = source.chapter,
      chunk = source.chunks[part];
    if (signal.aborted) throw new Error('章节预排版已取消。');
    if (!chunk) throw new Error('章节内容缺失。');
    const end = beginMeasure('正文分块排版');
    const root = document.createElement('div');
    root.className = 'reader-content';
    if (this.book.type === 'md' || this.book.draftFormat === 'markdown')
      root.dataset.format = 'markdown';
    root.dataset.chapter = String(index);
    root.dataset.chunk = String(part);
    root.lang = contentLanguage(chapter.paragraphs);
    if (source.chunks.length > 1) root.dataset.chunked = 'true';
    root.style.visibility = 'hidden';
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
    let releaseImages = () => {},
      released = false;
    const release = () => {
      if (released) return;
      released = true;
      root.remove();
      releaseImages();
    };
    signal.addEventListener('abort', release, { once: true });
    try {
      if (chapter.nodes) {
        const rendered = await renderNodes(
          source.chunks.length === 1
            ? chapter.nodes
            : nodesForChunk(
                chapter.nodes,
                chunk,
                chapter.paragraphs,
                source.chunks,
              ),
          new Map(
            chunk.paragraphs.map((span) => [span.paragraphIndex, span.start]),
          ),
        );
        releaseImages = rendered.release;
        if (signal.aborted) {
          rendered.release();
          throw new Error('章节预排版已取消。');
        }
        root.append(rendered.fragment);
        const first = root.firstElementChild;
        if (part === 0 && first && /^H[1-6]$/.test(first.tagName))
          first.classList.add('reader-chapter-title');
      } else {
        if (part === 0) {
          const title = document.createElement('h2');
          title.className = 'reader-chapter-title';
          title.textContent = chapter.title;
          root.append(title);
        }
        chunk.paragraphs.forEach(({ paragraphIndex, start, end }) => {
          const p = document.createElement('p');
          p.dataset.p = String(paragraphIndex);
          if (start) p.dataset.charStart = String(start);
          p.textContent = chapter.paragraphs[paragraphIndex]!.slice(start, end);
          root.append(p);
        });
      }
      if (signal.aborted) throw new Error('章节预排版已取消。');
      const instance = {
        key,
        source,
        chapter,
        chunk,
        root,
        pages: 1,
        stride: 1,
        release,
        finalized: false,
      };
      this.host.append(root);
      this.layout(instance);
      await Promise.all(
        Array.from(root.querySelectorAll('img')).map((image) =>
          image.decode().catch(() => {}),
        ),
      );
      await document.fonts.ready;
      if (signal.aborted || this.disposed)
        throw new Error('章节预排版已取消。');
      instance.finalized = true;
      this.layout(instance);
      return instance;
    } catch (error) {
      release();
      throw error;
    } finally {
      signal.removeEventListener('abort', release);
      end(!signal.aborted);
    }
  }
  async start(position: Promise<Locator | undefined>) {
    const end = beginMeasure('阅读正文就绪');
    try {
      const target = await position;
      if (!this.disposed) await this.show(target ?? this.anchor);
    } catch (error) {
      if (!this.disposed)
        this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.running = false;
      end(!this.disposed);
      this.scheduleMeasurement();
      void this.drain();
    }
  }
  private async show(
    target: Locator,
    last = false,
    offset?: number,
    part?: number,
  ) {
    if (this.disposed) return;
    this.motion.cancel();
    this.cancelMeasurement();
    const generation = ++this.generation;
    if (this.book.chapterCount < 1) throw new Error('书籍没有章节。');
    const index = Math.max(
      0,
      Math.min(
        this.book.chapterCount - 1,
        Number.isFinite(target.chapterIndex)
          ? Math.floor(target.chapterIndex)
          : 0,
      ),
    );
    if (index < 0) throw new Error('书籍没有章节。');
    this.sources.retain(
      this.active ? [this.active.chapter.index, index] : [index],
    );
    const source = await this.sources.get(index);
    if (this.disposed) return;
    let locator =
      offset === undefined
        ? clampLocator(source.chapter, target)
        : locatorAtOffset(source.chapter, offset);
    const chunk =
      source.chunks[
        part ??
          (last
            ? source.chunks.length - 1
            : chunkForLocator(source.chunks, locator).index)
      ]!;
    if (part !== undefined)
      locator = {
        chapterIndex: index,
        paragraphIndex: chunk.paragraphs[0]?.paragraphIndex ?? 0,
        charOffset: chunk.paragraphs[0]?.start ?? 0,
      };
    const key = `${index}:${chunk.index}`;
    const ready = this.window.ready(key);
    // 等待目标块期间仍显示旧正文，淘汰其余不再需要的DOM。
    this.window.retain(this.active ? [this.active.key, key] : [key]);
    const next = ready ?? (await this.window.get(key));
    if (this.disposed) return;
    this.paintHighlights();
    this.page = last
      ? next.pages - 1
      : Math.min(next.pages - 1, pageOf(next.root, locator, next.stride));
    if (this.active && this.active !== next) {
      this.active.root.style.visibility = 'hidden';
      this.active.root.setAttribute('aria-hidden', 'true');
      this.active.root.inert = true;
    }
    this.active = next;
    this.update(last ? undefined : locator);
    next.root.style.visibility = 'visible';
    next.root.removeAttribute('aria-hidden');
    next.root.inert = false;
    void this.preload(next, generation);
    this.scheduleMeasurement();
  }
  private async neighbor(active: ChapterInstance, direction: number) {
    const part = active.chunk.index + direction;
    if (part >= 0 && part < active.source.chunks.length)
      return {
        chapterIndex: active.chapter.index,
        part,
        key: `${active.chapter.index}:${part}`,
      };
    const index = active.chapter.index + direction;
    if (index < 0 || index >= this.book.chapterCount) return;
    const source = await this.sources.get(index);
    const next = direction < 0 ? source.chunks.length - 1 : 0;
    return { chapterIndex: index, part: next, key: `${index}:${next}` };
  }
  private async preload(active: ChapterInstance, generation: number) {
    const results = await Promise.allSettled([
      this.neighbor(active, -1),
      this.neighbor(active, 1),
    ]);
    if (this.disposed || generation !== this.generation) return;
    const neighbors = results.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
    this.window.retain([active.key, ...neighbors.map((item) => item.key)]);
    this.sources.retain([
      active.chapter.index,
      ...neighbors.map((item) => item.chapterIndex),
    ]);
    for (const adjacent of neighbors)
      void this.window
        .get(adjacent.key)
        .then(() => {
          if (!this.disposed) {
            this.paintHighlights();
            if (
              generation === this.generation &&
              this.active === active &&
              this.pageCounts
                .get(active.chapter.index)
                ?.every((n) => n !== undefined)
            )
              this.update(this.anchor);
          }
        })
        .catch(() => {});
  }
  private cancelMeasurement() {
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    this.measuring?.abort();
    this.measuring = undefined;
  }
  private scheduleMeasurement() {
    if (
      this.disposed ||
      this.cancelIdle ||
      this.measuring ||
      document.visibilityState === 'hidden' ||
      !this.active ||
      this.active.source.chunks.length === 1
    )
      return;
    const active = this.active;
    const unmeasured = () =>
      this.pageCounts
        .get(active.chapter.index)
        ?.findIndex(
          (value, part) =>
            value === undefined &&
            !this.failedMeasurements.has(`${active.chapter.index}:${part}`),
        ) ?? -1;
    if (unmeasured() < 0) return;
    this.cancelIdle = onIdle(() => {
      this.cancelIdle = undefined;
      if (this.disposed || this.active !== active) return;
      if (this.running || document.visibilityState === 'hidden') {
        this.scheduleMeasurement();
        return;
      }
      // 邻块可能已在等待空闲期间排好；不重复构建已经测量的块。
      const part = unmeasured();
      if (part < 0) return;
      const key = `${active.chapter.index}:${part}`;
      const abort = new AbortController();
      this.measuring = abort;
      void this.create(key, abort.signal)
        .then((instance) => {
          instance.release();
          if (
            !abort.signal.aborted &&
            !this.disposed &&
            this.active === active &&
            this.pageCounts
              .get(active.chapter.index)
              ?.every((value) => value !== undefined)
          )
            this.update(this.anchor);
        })
        .catch(() => {
          if (!abort.signal.aborted) this.failedMeasurements.add(key);
        })
        .finally(() => {
          if (this.measuring === abort) {
            this.measuring = undefined;
            if (!abort.signal.aborted) this.scheduleMeasurement();
          }
        });
    });
  }
  private update(preserved?: Locator) {
    const active = this.active;
    if (!active || this.disposed) return;
    active.root.style.transform = `translateX(${-this.page * active.stride}px)`;
    this.anchor =
      preserved ??
      getLocator(active.root, this.page, active.chapter.index, active.stride);
    const counts = this.pageCounts.get(active.chapter.index);
    const paginationReady = !!counts?.every((value) => value !== undefined);
    // 锚点是页首，全书末页需单独记为读完，否则短书永远停在中途百分比。
    const finished =
      active.chapter.index === this.book.chapterCount - 1 &&
      active.chunk.index === active.source.chunks.length - 1 &&
      this.page >= active.pages - 1;
    this.onUpdate({
      title:
        currentSection(this.book.toc, this.anchor)?.title ??
        active.chapter.title,
      chapterIndex: active.chapter.index,
      page: paginationReady
        ? counts!
            .slice(0, active.chunk.index)
            .reduce<number>((sum, value) => sum + (value ?? 0), 0) +
          this.page +
          1
        : this.page + 1,
      pages: paginationReady
        ? counts!.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : active.pages,
      paginationReady,
      percent: finished
        ? 100
        : percentOf(active.chapter, this.anchor, this.book.charCount),
      locator: { ...this.anchor },
    });
    this.paintSpeech();
  }
  turn(direction: number) {
    this.queue.push({ kind: 'turn', direction: direction < 0 ? -1 : 1 });
    void this.drain();
  }
  jump(locator: Locator, remember = true) {
    this.queue.push({ kind: 'jump', locator: { ...locator }, remember });
    void this.drain();
  }
  jumpPercent(value: number, chapters: ChapterSummary[]) {
    this.queue.push({ kind: 'percent', value, chapters });
    void this.drain();
  }
  private async drain() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        this.motion.cancel();
        this.cancelMeasurement();
        const command = this.queue.shift()!;
        if (
          this.beforeNavigate &&
          (command.kind !== 'jump' || command.remember)
        )
          await this.beforeNavigate();
        if (command.kind === 'turn') {
          if (!this.active) continue;
          const previous = this.active,
            from = previous.root.style.transform;
          const nextPage = this.page + command.direction;
          if (nextPage >= 0 && nextPage < this.active.pages) {
            this.page = nextPage;
            this.update();
          } else {
            const edge =
              command.direction < 0
                ? this.active.chapter.index === 0 &&
                  this.active.chunk.index === 0
                : this.active.chapter.index === this.book.chapterCount - 1 &&
                  this.active.chunk.index ===
                    this.active.source.chunks.length - 1;
            const target = edge
              ? undefined
              : await this.neighbor(this.active, command.direction);
            if (target)
              await this.show(
                {
                  chapterIndex: target.chapterIndex,
                  paragraphIndex: 0,
                  charOffset: 0,
                },
                command.direction < 0,
                undefined,
                target.part,
              );
            else this.cancelDrag();
          }
          if (
            this.active &&
            (this.active !== previous ||
              this.active.root.style.transform !== from)
          )
            this.motion.play(
              this.reading.pageAnimation,
              previous,
              this.active,
              from,
              command.direction,
            );
        } else {
          const previous = this.currentLocator;
          if (command.kind === 'jump') {
            await this.show(command.locator);
            if (command.highlightId && !this.disposed)
              this.highlightLayer.flash(command.highlightId);
          } else {
            const target = chapterAtPercent(
              command.chapters,
              this.book.charCount,
              command.value,
            );
            if (!target) throw new Error('目录尚未就绪，请稍后重试。');
            await this.show(
              {
                chapterIndex: target.chapter.index,
                paragraphIndex: 0,
                charOffset: 0,
              },
              false,
              target.offset,
            );
          }
          if (
            previous &&
            (command.kind === 'percent' || command.remember) &&
            !this.disposed
          )
            this.onJump(previous);
        }
      }
    } catch (error) {
      this.queue = [];
      this.cancelDrag();
      if (!this.disposed)
        this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.running = false;
      this.scheduleMeasurement();
    }
  }
  drag(dx: number) {
    this.motion.cancel();
    if (
      this.active &&
      !this.running &&
      this.reading.pageAnimation === 'slide' &&
      this.motion.enabled
    )
      this.active.root.style.transform = `translateX(${-this.page * this.active.stride + dx}px)`;
  }
  stopMotion() {
    this.motion.cancel();
  }
  setPageAnimation(mode: ReadingSettings['pageAnimation']) {
    this.motion.cancel();
    this.reading.pageAnimation = mode;
  }
  cancelDrag() {
    this.motion.cancel();
    if (this.active)
      this.active.root.style.transform = `translateX(${-this.page * this.active.stride}px)`;
  }
  dispose() {
    this.speechRanges = [];
    this.paintSpeech();
    this.disposed = true;
    ++this.generation;
    this.cancelMeasurement();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.queue = [];
    this.highlightLayer.dispose();
    this.motion.dispose();
    this.window.dispose();
    this.sources.dispose();
    this.pageCounts.clear();
    this.failedMeasurements.clear();
    this.host.replaceChildren();
  }
}
