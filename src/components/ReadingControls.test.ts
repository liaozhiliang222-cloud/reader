// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingControls } from './ReadingControls';
import { TapHint } from './TapHint';
import { defaultReading } from '@/app/defaults';

const root = document.createElement('div');
document.body.append(root);
afterEach(async () => {
  await act(() => render(null, root));
  vi.useRealTimers();
});
const button = (label: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
it('字号步进在 14–28 之间，分段选项与色块直接回传对应值', async () => {
  const onChange = vi.fn();
  await act(() =>
    render(
      createElement(ReadingControls, {
        value: { ...defaultReading, fontSize: 28 },
        onChange,
      }),
      root,
    ),
  );
  expect(button('增大字号').disabled).toBe(true);
  await act(() => button('减小字号').click());
  expect(onChange).toHaveBeenLastCalledWith({ fontSize: 27 });
  const radio = (legend: string, value: string) =>
    [...root.querySelectorAll('fieldset')]
      .find((group) => group.querySelector('legend')?.textContent === legend)!
      .querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
  await act(() => radio('翻页动效', 'fade').click());
  expect(onChange).toHaveBeenLastCalledWith({ pageAnimation: 'fade' });
  await act(() => radio('行距', '2.2').click());
  expect(onChange).toHaveBeenLastCalledWith({ lineHeight: 2.2 });
  await act(() => radio('主题', 'night').click());
  expect(onChange).toHaveBeenLastCalledWith({ theme: 'night' });
  expect(radio('字体', 'wenkai').disabled).toBe(true);
});
it('点按分区提示只通知一次已显示，按下或三秒后消失，单手模式两侧都是下一页', async () => {
  vi.useFakeTimers();
  const shown = vi.fn();
  await act(() =>
    render(createElement(TapHint, { mode: 'oneHand', onShown: shown }), root),
  );
  expect(shown).toHaveBeenCalledOnce();
  expect(root.textContent).toContain('左上角：上一页');
  expect(root.textContent?.match(/下一页/g)).toHaveLength(2);
  await act(() => {
    document.dispatchEvent(new Event('pointerdown'));
  });
  expect(root.querySelector('.tap-hint')).toBeNull();
  await act(() => render(null, root));
  await act(() =>
    render(createElement(TapHint, { mode: 'normal', onShown: shown }), root),
  );
  expect(root.textContent).toContain('上一页');
  await act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(root.querySelector('.tap-hint')).toBeNull();
});
