// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { PageMotion } from './PageMotion';
import type { MediaState } from '@/app/media';

function fixture() {
  const events = new EventTarget();
  let matches = false;
  const media: MediaState = {
    get matches() {
      return matches;
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const motions: Array<{
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
  }> = [];
  const animate = vi.fn<HTMLElement['animate']>(() => {
    const animation = {
      cancel: vi.fn(),
      onfinish: null as (() => void) | null,
    };
    motions.push(animation);
    return animation as unknown as Animation;
  });
  const page = () => {
    const root = document.createElement('div');
    root.style.transform = 'translateX(-390px)';
    root.animate = animate;
    return { root, stride: 390 };
  };
  const controller = new PageMotion(media);
  return {
    controller,
    media,
    animate,
    motions,
    page,
    reduce: () => {
      matches = true;
      events.dispatchEvent(new Event('change'));
    },
  };
}
afterEach(() => vi.restoreAllMocks());
it('平移220ms及淡入160ms只覆盖视觉属性，不修改正文节点和目标位移', () => {
  const f = fixture(),
    current = f.page();
  const paragraph = document.createElement('p');
  paragraph.textContent = '保持原节点和锚点';
  current.root.append(paragraph);
  f.controller.play('slide', current, current, 'translateX(0px)', 1);
  expect(f.animate).toHaveBeenCalledWith(
    [{ transform: 'translateX(0px)' }, { transform: 'translateX(-390px)' }],
    { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
  expect(current.root.style.transform).toBe('translateX(-390px)');
  expect(current.root.firstElementChild).toBe(paragraph);
  f.controller.play('fade', current, current, 'translateX(0px)', 1);
  expect(f.motions[0]!.cancel).toHaveBeenCalledOnce();
  expect(f.animate).toHaveBeenLastCalledWith([{ opacity: 0 }, { opacity: 1 }], {
    duration: 160,
    easing: 'ease-out',
  });
  f.motions[1]!.onfinish!();
  expect(f.motions[1]!.cancel).toHaveBeenCalledOnce();
  f.controller.dispose();
});
it('跨章时保留旧页视觉且保持其不可访问，完成/取消后恢复隐藏；反向切章方向正确', () => {
  const f = fixture(),
    previous = f.page(),
    current = f.page();
  previous.root.style.visibility = 'hidden';
  previous.root.inert = true;
  previous.root.setAttribute('aria-hidden', 'true');
  f.controller.play('slide', previous, current, 'translateX(-780px)', -1);
  expect(previous.root.style.visibility).toBe('visible');
  expect(previous.root.inert).toBe(true);
  expect(previous.root.getAttribute('aria-hidden')).toBe('true');
  expect(f.animate.mock.calls[1]?.[0]).toEqual([
    { transform: 'translateX(-390px) translateX(-390px)' },
    { transform: 'translateX(-390px)' },
  ]);
  f.controller.cancel();
  expect(previous.root.style.visibility).toBe('hidden');
  expect(
    f.motions.every((animation) => animation.cancel.mock.calls.length === 1),
  ).toBe(true);
  f.controller.dispose();
});
it('开启减弱动态立即终止在途动画，none/减弱/销毁后不播放，迟到事件不再操作', () => {
  const f = fixture(),
    current = f.page();
  f.controller.play('slide', current, current, 'translateX(0px)', 1);
  f.reduce();
  expect(f.motions[0]!.cancel).toHaveBeenCalledOnce();
  expect(f.controller.enabled).toBe(false);
  f.controller.play('slide', current, current, 'translateX(0px)', 1);
  f.controller.play('none', current, current, 'translateX(0px)', 1);
  expect(f.animate).toHaveBeenCalledOnce();
  f.controller.dispose();
  f.reduce();
  f.controller.play('fade', current, current, 'translateX(0px)', 1);
  expect(f.animate).toHaveBeenCalledOnce();
});
it('动画接口缺失或抛错时回到静态正文，不把视觉失败当作翻页失败', () => {
  const f = fixture(),
    previous = f.page(),
    current = f.page();
  current.root.animate = undefined as unknown as typeof current.root.animate;
  f.controller.play('slide', previous, current, 'translateX(0px)', 1);
  expect(f.animate).not.toHaveBeenCalled();
  current.root.animate = f.animate;
  f.animate.mockImplementationOnce(() => {
    throw new Error('unsupported');
  });
  f.controller.play('slide', previous, current, 'translateX(0px)', 1);
  expect(previous.root.style.visibility).toBe('hidden');
  expect(current.root.style.transform).toBe('translateX(-390px)');
  f.controller.dispose();
});
