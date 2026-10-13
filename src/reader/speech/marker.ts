/**
 * 听书当前句高亮：在渲染根上把句子原文区间包成
 * `mark[data-jingye-speech]`。与注记 HighlightLayer 互不干扰：
 * 独立 mark 属性、独立签名缓存、拆开的文本节点在 unwrap 时归并。
 */
import { canonicalWalker } from '../text';

interface Root {
  root: HTMLElement;
  chapter: { index: number };
}

export interface SpeechMark {
  chapterIndex: number;
  /** 段落相对原文区间，可能因行内过滤出现同段多条。 */
  ranges: { paragraphIndex: number; start: number; end: number }[];
}

function unwrap(root: HTMLElement) {
  for (const mark of root.querySelectorAll('mark[data-jingye-speech]'))
    mark.replaceWith(...mark.childNodes);
  for (const p of root.querySelectorAll('[data-p]')) p.normalize();
}

function wrap(root: HTMLElement, mark: SpeechMark) {
  for (const range of mark.ranges) {
    for (const p of root.querySelectorAll<HTMLElement>(
      `[data-p="${range.paragraphIndex}"]`,
    )) {
      const base = Number(p.dataset.charStart ?? 0);
      const start = range.start - base,
        end = range.end - base;
      if (end <= 0 || start < 0 || end <= start) continue;
      const walker = canonicalWalker(p);
      const nodes: Node[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      let offset = 0;
      for (const node of nodes) {
        const text = node.textContent ?? '';
        const from = Math.max(0, start - offset),
          to = Math.min(text.length, end - offset);
        offset += text.length;
        if (to <= from || to <= 0 || from >= text.length) continue;
        const fragment = document.createDocumentFragment();
        if (from > 0)
          fragment.append(document.createTextNode(text.slice(0, from)));
        const element = document.createElement('mark');
        element.dataset.jingyeSpeech = 'true';
        element.append(document.createTextNode(text.slice(from, to)));
        fragment.append(element);
        if (to < text.length)
          fragment.append(document.createTextNode(text.slice(to)));
        node.parentNode?.replaceChild(fragment, node);
      }
    }
  }
}

export class SpeechMarker {
  private roots: Root[] = [];
  private painted = new Map<HTMLElement, string>();
  /** 当前句标记；null 表示清除。 */
  render(roots: Root[], mark: SpeechMark | null) {
    const signature = mark ? JSON.stringify(mark.ranges) : '';
    for (const { root, chapter } of roots) {
      const applies = mark !== null && chapter.index === mark.chapterIndex;
      const target = applies ? signature : '';
      if (this.painted.get(root) === target) continue;
      unwrap(root);
      if (applies) wrap(root, mark!);
      this.painted.set(root, target);
    }
    // 窗口已淘汰的根直接清缓存。
    for (const root of [...this.painted.keys()])
      if (!roots.some((next) => next.root === root)) this.painted.delete(root);
    this.roots = roots;
  }
  dispose() {
    for (const { root } of this.roots) unwrap(root);
    this.roots = [];
    this.painted.clear();
  }
}
