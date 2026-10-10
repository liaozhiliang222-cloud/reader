// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { HighlightLayer } from './highlight';
import { rangeForSpan, spanFromRange } from './selection';
import type { Highlight } from '@/types';

function fixture() {
  const root = document.createElement('div');
  root.innerHTML =
    '<h2>章标题</h2><p data-p="0">甲<strong>乙😀丙</strong><em>丁</em></p><p data-p="1">戊<br>己<ruby>庚<rt>geng</rt></ruby></p><p data-p="2"><img alt="图"></p>';
  document.body.append(root);
  const paragraphs = [...root.querySelectorAll<HTMLElement>('[data-p]')].map(
    (p) => p.textContent ?? '',
  );
  return { root, paragraphs };
}
const item = (id = 'red'): Highlight => ({
  id,
  bookId: 'b',
  chapterIndex: 0,
  start: { paragraphIndex: 0, charOffset: 2 },
  end: { paragraphIndex: 1, charOffset: 5 },
  text: '😀丙丁\n戊己庚ge',
  color: 'red',
  createdAt: 1,
  updatedAt: 1,
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('跨嵌套节点和跨段选区转换，注音计数与段落存储相同', () => {
  const { root, paragraphs } = fixture();
  const range = document.createRange();
  range.setStart(root.querySelector('strong')!.firstChild!, 1);
  range.setEnd(root.querySelector('rt')!.firstChild!, 2);
  const span = spanFromRange(root, 0, paragraphs, range)!;
  expect(span).toMatchObject({
    start: item().start,
    end: item().end,
    text: item().text,
  });
  expect(rangeForSpan(root, span)?.toString()).toBe('😀丙丁戊己庚ge');
});
it('以元素子节点边界选中全章，仅保存可定位正文；跨章节或空选区拒绝', () => {
  const { root, paragraphs } = fixture();
  const range = document.createRange();
  range.selectNodeContents(root);
  expect(spanFromRange(root, 0, paragraphs, range)).toMatchObject({
    start: { paragraphIndex: 0, charOffset: 0 },
    end: { paragraphIndex: 1, charOffset: 7 },
  });
  range.setStart(document.body, 0);
  expect(spanFromRange(root, 0, paragraphs, range)).toBeUndefined();
  range.selectNodeContents(root);
  range.collapse(true);
  expect(spanFromRange(root, 0, paragraphs, range)).toBeUndefined();
});
it('mark 回退保持强调、注音与原文；重复渲染、重叠改色和删除可逆', () => {
  const { root, paragraphs } = fixture();
  const original = root.textContent;
  const layer = new HighlightLayer(false);
  const red = item(),
    blue = {
      ...item('blue'),
      color: 'blue' as const,
      createdAt: 2,
      start: { paragraphIndex: 0, charOffset: 4 },
      end: { paragraphIndex: 0, charOffset: 6 },
    };
  for (let n = 0; n < 10; n++)
    layer.render([{ root, chapter: { index: 0 } }], [red, blue]);
  expect(root.textContent).toBe(original);
  expect(root.querySelectorAll('strong')).toHaveLength(1);
  expect(root.querySelectorAll('ruby rt')).toHaveLength(1);
  expect(root.querySelector('em mark')?.textContent).toBe('丁');
  expect(root.querySelector('em mark')?.getAttribute('data-color')).toBe(
    'blue',
  );
  expect(root.querySelector('mark mark')).toBeNull();
  expect(
    spanFromRange(root, 0, paragraphs, rangeForSpan(root, red)!),
  ).toMatchObject({ start: red.start, end: red.end, text: red.text });
  layer.render([{ root, chapter: { index: 0 } }], [blue]);
  expect(root.querySelector('mark[data-color="red"]')).toBeNull();
  layer.dispose();
  expect(root.querySelector('mark')).toBeNull();
  expect(root.textContent).toBe(original);
});
it('不存在的段落与过大偏移不在 DOM 中生成错误范围', () => {
  const { root } = fixture();
  expect(
    rangeForSpan(root, {
      ...item(),
      end: { paragraphIndex: 99, charOffset: 0 },
    }),
  ).toBeUndefined();
  expect(
    rangeForSpan(root, {
      ...item(),
      end: { paragraphIndex: 0, charOffset: 99 },
    }),
  ).toBeUndefined();
});
it('预排版相邻章和只改笔记时复用正文节点，不打断正在选择的文字', () => {
  const { root } = fixture(),
    next = fixture().root;
  const layer = new HighlightLayer(false),
    red = item();
  layer.render([{ root, chapter: { index: 0 } }], [red]);
  const mark = root.querySelector('mark')!;
  const range = rangeForSpan(root, red)!;
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const selected = selection.toString(),
    start = range.startContainer;
  layer.render(
    [
      { root, chapter: { index: 0 } },
      { root: next, chapter: { index: 1 } },
    ],
    [{ ...red, note: '后改的笔记', updatedAt: 99 }],
  );
  expect(root.querySelector('mark')).toBe(mark);
  expect(range.startContainer).toBe(start);
  expect(selection.toString()).toBe(selected);
  layer.dispose();
});
it('原生 Highlight 与 mark 对重叠范围采用相同优先级，并只释放自身 registry', () => {
  const { root } = fixture();
  root.querySelector('ruby')!.replaceWith('庚geng');
  root.querySelector('img')!.remove();
  const registry = new Map<string, Set<AbstractRange>>();
  registry.set('unrelated', new Set());
  class NativeHighlight extends Set<AbstractRange> {
    priority = 0;
    constructor(...ranges: AbstractRange[]) {
      super(ranges);
    }
  }
  vi.stubGlobal('Highlight', NativeHighlight);
  vi.stubGlobal('CSS', { highlights: registry });
  const layer = new HighlightLayer(true);
  const red = {
    ...item(),
    start: { paragraphIndex: 0, charOffset: 0 },
    end: { paragraphIndex: 0, charOffset: 5 },
  };
  const blue = {
    ...red,
    id: 'blue',
    color: 'blue' as const,
    createdAt: 2,
    start: { paragraphIndex: 0, charOffset: 2 },
    end: { paragraphIndex: 0, charOffset: 6 },
  };
  layer.render([{ root, chapter: { index: 0 } }], [red, blue]);
  expect(root.querySelector('mark')).toBeNull();
  expect(
    [...registry.get('jingye-red')!].map((r) => (r as Range).toString()),
  ).toEqual(['甲乙']);
  expect(
    [...registry.get('jingye-blue')!].map((r) => (r as Range).toString()),
  ).toEqual(['😀丙', '丁']);
  layer.dispose();
  expect([...registry.keys()]).toEqual(['unrelated']);
});
it('跳转闪烁会结束，渲染刷新仍保留提示，卸载清理定时器', () => {
  vi.useFakeTimers();
  const { root } = fixture(),
    layer = new HighlightLayer(false);
  const roots = [{ root, chapter: { index: 0 } }];
  layer.render(roots, [item()]);
  layer.flash('red');
  expect(root.querySelector('[data-flash="true"]')).not.toBeNull();
  layer.render(roots, [item()]);
  expect(root.querySelector('[data-flash="true"]')).not.toBeNull();
  vi.advanceTimersByTime(500);
  layer.render(roots, [item()]);
  expect(root.querySelector('[data-flash="true"]')).toBeNull();
  vi.advanceTimersByTime(400);
  expect(root.querySelector('[data-flash="true"]')).toBeNull();
  layer.render(roots, [item()]);
  expect(root.querySelector('[data-flash="true"]')).toBeNull();
  layer.flash('red');
  layer.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('同一窗口原生与注音图片mark可共存，闪烁只落在文字且重绘保留结构', () => {
  vi.useFakeTimers();
  const registry = new Map<string, Set<AbstractRange>>([
    ['unrelated', new Set()],
  ]);
  class NativeHighlight extends Set<AbstractRange> {
    priority = 0;
    constructor(...ranges: AbstractRange[]) {
      super(ranges);
    }
  }
  vi.stubGlobal('Highlight', NativeHighlight);
  vi.stubGlobal('CSS', { highlights: registry });
  const { root } = fixture(),
    plain = document.createElement('div');
  plain.innerHTML = '<p data-p="0">甲乙😀丙丁</p>';
  document.body.append(plain);
  const original = root.innerHTML;
  const roots = [
    { root, chapter: { index: 0 } },
    { root: plain, chapter: { index: 1 } },
  ];
  const note = item(),
    other = {
      ...item('plain'),
      chapterIndex: 1,
      start: { paragraphIndex: 0, charOffset: 0 },
      end: { paragraphIndex: 0, charOffset: 2 },
    };
  const layer = new HighlightLayer(true);
  layer.render(roots, [note, other]);
  expect(root.querySelector('ruby rt mark')?.textContent).toBe('ge');
  expect(root.querySelector('img')?.closest('mark')).toBeNull();
  expect(plain.querySelector('mark')).toBeNull();
  expect(
    [...registry.get('jingye-red')!].map((r) => (r as Range).toString()),
  ).toEqual(['甲乙']);
  layer.flash(note.id);
  expect(registry.has('jingye-focus')).toBe(false);
  expect(root.querySelector('[data-flash="true"]')).not.toBeNull();
  const mark = root.querySelector('mark');
  layer.render(roots, [{ ...note, note: '追加', updatedAt: 2 }, other]);
  expect(root.querySelector('mark')).toBe(mark);
  vi.advanceTimersByTime(900);
  expect(root.querySelector('[data-flash="true"]')).toBeNull();
  layer.flash(other.id);
  expect(registry.has('jingye-focus')).toBe(true);
  expect(root.querySelector('[data-flash="true"]')).toBeNull();
  layer.dispose();
  expect(root.innerHTML).toBe(original);
  expect([...registry.keys()]).toEqual(['unrelated']);
  expect(vi.getTimerCount()).toBe(0);
});
it('含图片的文字mark在该根移除图片或离开窗口后清理，并可回到原生绘制', () => {
  const registry = new Map<string, Set<AbstractRange>>();
  class NativeHighlight extends Set<AbstractRange> {
    priority = 0;
    constructor(...ranges: AbstractRange[]) {
      super(ranges);
    }
  }
  vi.stubGlobal('Highlight', NativeHighlight);
  vi.stubGlobal('CSS', { highlights: registry });
  const root = document.createElement('div');
  root.innerHTML = '<p data-p="0">甲<img alt="图">乙😀丙丁</p>';
  document.body.append(root);
  const note = {
    ...item(),
    start: { paragraphIndex: 0, charOffset: 0 },
    end: { paragraphIndex: 0, charOffset: 6 },
  };
  const layer = new HighlightLayer(true);
  layer.render([{ root, chapter: { index: 0 } }], [note]);
  expect(
    [...root.querySelectorAll('mark')].map((mark) => mark.textContent).join(''),
  ).toBe('甲乙😀丙丁');
  expect(root.querySelector('img')?.closest('mark')).toBeNull();
  root.querySelector('img')!.remove();
  layer.render([{ root, chapter: { index: 0 } }], [note]);
  expect(root.querySelector('mark')).toBeNull();
  expect(
    [...registry.get('jingye-red')!]
      .map((r) => (r as Range).toString())
      .join(''),
  ).toBe('甲乙😀丙丁');
  root.querySelector('p')!.append(document.createElement('img'));
  layer.render([{ root, chapter: { index: 0 } }], [note]);
  expect(root.querySelector('mark')).not.toBeNull();
  layer.render([], []);
  expect(root.querySelector('mark')).toBeNull();
  layer.dispose();
});
