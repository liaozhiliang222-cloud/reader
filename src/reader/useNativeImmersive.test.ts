// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ setImmersive: vi.fn(async () => {}) }));
vi.mock('@/app/platform', async () => {
  const { signal } = await import('@preact/signals');
  return {
    isNativeApp: true,
    nativeApp: async () => native,
    nativeImmersive: signal(true),
  };
});
import { useImmersive } from './useImmersive';

it('退出原生阅读页恢复系统栏', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  function Reader() {
    useImmersive('off');
    return createElement('p', {}, '正文');
  }
  try {
    await act(() => render(createElement(Reader, {}), root));
    await act(() => render(null, root));
    expect(native.setImmersive).toHaveBeenCalledWith(false);
  } finally {
    render(null, root);
    root.remove();
  }
});
