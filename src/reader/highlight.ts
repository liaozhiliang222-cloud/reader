import { highlightSegments } from './annotation';
import { rangeForSpan, visibleRangeRect } from './selection';
import type { Highlight as Annotation } from '@/types';
import { canonicalText, canonicalWalker } from './text';

interface Root {
  root: HTMLElement;
  chapter: { index: number };
}
const colors = ['red', 'blue', 'yellow'] as const;
const names = [...colors.map((color) => `jingye-${color}`), 'jingye-focus'];
function unwrap(root: HTMLElement) {
  for (const mark of root.querySelectorAll('mark[data-jingye-highlight]'))
    mark.replaceWith(...mark.childNodes);
  for (const p of root.querySelectorAll('[data-p]')) p.normalize();
}
function wrap(root: HTMLElement, items: Annotation[]) {
  for (const p of root.querySelectorAll<HTMLElement>('[data-p]')) {
    const index = Number(p.dataset.p);
    const base = Number(p.dataset.charStart ?? 0);
    const spans = items
      .filter(
        (item) =>
          item.start.paragraphIndex <= index &&
          item.end.paragraphIndex >= index,
      )
      .map((item) => ({
        item,
        start:
          item.start.paragraphIndex === index
            ? item.start.charOffset - base
            : 0,
        end:
          item.end.paragraphIndex === index
            ? item.end.charOffset - base
            : canonicalText(p).length,
      }));
    if (!spans.length) continue;
    const walker = canonicalWalker(p);
    const nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let offset = 0;
    for (const node of nodes) {
      const text = node.textContent ?? '';
      const parts = highlightSegments(
        text.length,
        spans.map((span) => ({
          ...span,
          start: span.start - offset,
          end: span.end - offset,
        })),
      );
      offset += text.length;
      if (!parts.some((part) => part.items.length)) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        const child = document.createTextNode(text.slice(part.start, part.end));
        if (!part.items.length) fragment.append(child);
        else {
          const mark = document.createElement('mark');
          mark.dataset.jingyeHighlight = part.items
            .map((item) => item.id)
            .join(' ');
          mark.dataset.color = part.items.at(-1)!.color;
          mark.append(child);
          fragment.append(mark);
        }
      }
      node.parentNode?.replaceChild(fragment, node);
    }
  }
}
/** 一个阅读器拥有一组 registry 名称；只清理自己注册的范围。 */
export class HighlightLayer {
  private roots: Root[] = [];
  private regions: { item: Annotation; range: Range; native: boolean }[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private native: boolean;
  private flashId?: string;
  private flashStartedAt = 0;
  private painted = new Map<HTMLElement, string>();
  constructor(
    native = typeof CSS !== 'undefined' &&
      !!CSS.highlights &&
      typeof globalThis.Highlight === 'function',
  ) {
    this.native = native;
  }
  render(roots: Root[], items: Annotation[]) {
    const flashing = this.flashId;
    const flashStartedAt = this.flashStartedAt;
    this.clearFlash();
    for (const { root } of this.roots) {
      if (!roots.some((next) => next.root === root)) {
        unwrap(root);
        this.painted.delete(root);
      }
    }
    this.roots = roots;
    this.regions = [];
    const ranges = {
      red: [] as Range[],
      blue: [] as Range[],
      yellow: [] as Range[],
    };
    for (const { root, chapter } of roots) {
      const chapterItems = items.filter(
        (item) => item.chapterIndex === chapter.index,
      );
      // Native highlight backgrounds can cover ruby readings and inline
      // images in a tall line box. Keep their paint on text-node marks.
      const native =
        this.native && !root.querySelector('ruby, img, [data-md-atom]');
      if (!native) {
        const signature = JSON.stringify(
          chapterItems.map(({ id, start, end, color, createdAt }) => [
            id,
            start,
            end,
            color,
            createdAt,
          ]),
        );
        if (this.painted.get(root) !== signature) {
          unwrap(root);
          wrap(root, chapterItems);
          this.painted.set(root, signature);
        }
      } else {
        if (this.painted.has(root)) {
          unwrap(root);
          this.painted.delete(root);
        }
        for (const p of root.querySelectorAll<HTMLElement>('[data-p]')) {
          const index = Number(p.dataset.p),
            base = Number(p.dataset.charStart ?? 0),
            length = canonicalText(p).length;
          const spans = chapterItems
            .filter(
              (item) =>
                item.start.paragraphIndex <= index &&
                item.end.paragraphIndex >= index,
            )
            .map((item) => ({
              item,
              start:
                item.start.paragraphIndex === index
                  ? item.start.charOffset - base
                  : 0,
              end:
                item.end.paragraphIndex === index
                  ? item.end.charOffset - base
                  : length,
            }));
          for (const segment of highlightSegments(length, spans)) {
            const winner = segment.items.at(-1);
            if (!winner) continue;
            const range = rangeForSpan(root, {
              chapterIndex: chapter.index,
              start: {
                paragraphIndex: index,
                charOffset: segment.start + base,
              },
              end: { paragraphIndex: index, charOffset: segment.end + base },
            });
            if (range) ranges[winner.color].push(range);
          }
        }
      }
      for (const item of chapterItems) {
        const range = rangeForSpan(root, item);
        if (range) this.regions.push({ item, range, native });
      }
    }
    if (this.native)
      for (const color of colors) {
        const highlight = new globalThis.Highlight(...ranges[color]);
        highlight.priority = colors.indexOf(color);
        CSS.highlights.set(`jingye-${color}`, highlight);
      }
    if (flashing) this.flash(flashing, flashStartedAt);
  }
  atPoint(root: HTMLElement, x: number, y: number, frame: HTMLElement) {
    for (const { item, range } of [...this.regions]
      .sort((a, b) => b.item.createdAt - a.item.createdAt)
      .filter((r) => root.contains(r.range.startContainer))) {
      if (
        [...range.getClientRects()].some(
          (r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom,
        )
      ) {
        const rect = visibleRangeRect(range, frame);
        if (rect) return { highlight: item, rect };
      }
    }
  }
  flash(id: string, startedAt = Date.now()) {
    this.clearFlash();
    const region = this.regions.find((r) => r.item.id === id);
    const elapsed = Date.now() - startedAt;
    if (!region || elapsed >= 900) return;
    this.flashId = id;
    this.flashStartedAt = startedAt;
    const toggle = (visible: boolean) => {
      if (region.native) {
        if (visible) {
          const highlight = new globalThis.Highlight(region.range);
          highlight.priority = 10;
          CSS.highlights.set('jingye-focus', highlight);
        } else CSS.highlights.delete('jingye-focus');
      } else
        for (const { root } of this.roots) {
          for (const mark of root.querySelectorAll<HTMLElement>(
            'mark[data-jingye-highlight]',
          ))
            if (mark.dataset.jingyeHighlight?.split(' ').includes(id))
              mark.dataset.flash = String(visible);
        }
    };
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    toggle(reduced || elapsed < 300 || elapsed >= 600);
    const steps = reduced
      ? []
      : ([
          [300, false],
          [600, true],
        ] as const);
    for (const [delay, visible] of steps)
      if (delay > elapsed)
        this.timers.push(setTimeout(() => toggle(visible), delay - elapsed));
    this.timers.push(
      setTimeout(() => {
        toggle(false);
        this.flashId = undefined;
      }, 900 - elapsed),
    );
  }
  private clearFlash() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.flashId = undefined;
    this.flashStartedAt = 0;
    if (this.native) CSS.highlights.delete('jingye-focus');
    for (const { root } of this.roots)
      for (const mark of root.querySelectorAll<HTMLElement>('[data-flash]'))
        delete mark.dataset.flash;
  }
  dispose() {
    this.clearFlash();
    if (this.native) names.forEach((name) => CSS.highlights.delete(name));
    this.roots.forEach(({ root }) => unwrap(root));
    this.roots = [];
    this.regions = [];
    this.painted.clear();
  }
}
