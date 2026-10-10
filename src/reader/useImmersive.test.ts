// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { useLayoutEffect } from 'preact/hooks';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useImmersive } from './useImmersive';

const root = document.createElement('div');
document.body.append(root);
const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
let fullscreenElement: Element | null = null;
beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
});
afterEach(async () => {
  fullscreenElement = null;
  await act(() => render(null, root));
  if (original) Object.defineProperty(document, 'fullscreenElement', original);
  else Reflect.deleteProperty(document, 'fullscreenElement');
});
function Panel({ earlyChange }: { earlyChange?: 'enter' | 'exit' }) {
  const { fullscreen } = useImmersive('off');
  // A native transition can finish after render but before passive effects.
  useLayoutEffect(() => {
    if (earlyChange) {
      fullscreenElement =
        earlyChange === 'enter' ? document.documentElement : null;
      document.dispatchEvent(new Event('fullscreenchange'));
    }
  }, [earlyChange]);
  return createElement('button', {}, fullscreen ? '退出全屏' : '全屏阅读');
}
it.each(['enter', 'exit'] as const)(
  '挂载与监听之间的全屏 %s 仍同步到按钮',
  async (earlyChange) => {
    fullscreenElement =
      earlyChange === 'exit' ? document.documentElement : null;
    await act(() => render(createElement(Panel, { earlyChange }), root));
    expect(root.textContent).toBe(
      earlyChange === 'enter' ? '退出全屏' : '全屏阅读',
    );
  },
);
it('监听开始后进入、退出全屏均更新按钮', async () => {
  await act(() =>
    render(createElement(Panel, { earlyChange: undefined }), root),
  );
  expect(root.textContent).toBe('全屏阅读');
  await act(() => {
    fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(root.textContent).toBe('退出全屏');
  await act(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(root.textContent).toBe('全屏阅读');
});
