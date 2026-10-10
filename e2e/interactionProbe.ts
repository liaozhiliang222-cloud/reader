import type { Page } from '@playwright/test';

export interface MotionRecord {
  duration: number | string;
  easing: string;
  keyframes: ComputedKeyframe[];
  startedAt: number;
  finishedAt?: number;
  cancelledAt?: number;
  initialState: AnimationPlayState;
  frames: { time: number; opacity: string; transform: string }[];
}
export interface InteractionProbe {
  animations: { animation: Animation; record: MotionRecord }[];
  pointers: {
    type: string;
    pointerType: string;
    trusted: boolean;
    target: string;
  }[];
  overlays: {
    className: string;
    inert: boolean;
    hidden: string | null;
    name: string;
    duration: string;
    easing: string;
    pointerEvents: string;
  }[];
}

/** Observe and forward native APIs; never replace animation, input or selection. */
export async function observeInteractions(page: Page) {
  await page.addInitScript(() => {
    const probe: InteractionProbe = {
      animations: [],
      pointers: [],
      overlays: [],
    };
    Reflect.set(window, 'jingyeInteractionProbe', probe);
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      if (this.matches('.reader-content')) {
        const effect = animation.effect as KeyframeEffect;
        const timing = effect.getTiming();
        const record: MotionRecord = {
          duration:
            typeof timing.duration === 'number'
              ? timing.duration
              : String(timing.duration ?? 'auto'),
          easing: timing.easing ?? 'linear',
          keyframes: effect.getKeyframes(),
          startedAt: performance.now(),
          initialState: animation.playState,
          frames: [],
        };
        probe.animations.push({ animation, record });
        animation.addEventListener('finish', () => {
          record.finishedAt = performance.now();
        });
        animation.addEventListener('cancel', () => {
          record.cancelledAt = performance.now();
        });
        const frame = () => {
          if (animation.playState !== 'running') return;
          const style = getComputedStyle(this);
          record.frames.push({
            time: performance.now(),
            opacity: style.opacity,
            transform: style.transform,
          });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }
      return animation;
    };
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
      document.addEventListener(
        type,
        (event) => {
          if (!(event instanceof PointerEvent)) return;
          probe.pointers.push({
            type,
            pointerType: event.pointerType,
            trusted: event.isTrusted,
            target: (event.target as Element).className,
          });
        },
        true,
      );
    }
    const observe = () => {
      for (const element of document.querySelectorAll<HTMLElement>(
        '.reader-menu, .reader-drawer',
      )) {
        const style = getComputedStyle(element);
        const item = {
          className: element.className,
          inert: element.inert,
          hidden: element.getAttribute('aria-hidden'),
          name: style.animationName,
          duration: style.animationDuration,
          easing: style.animationTimingFunction,
          pointerEvents: style.pointerEvents,
        };
        if (
          !probe.overlays.some(
            (entry) => JSON.stringify(entry) === JSON.stringify(item),
          )
        )
          probe.overlays.push(item);
      }
    };
    new MutationObserver(observe).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'inert', 'aria-hidden'],
    });
  });
}

export async function interactionEvidence(page: Page) {
  return page.evaluate(() => {
    const probe = Reflect.get(
      window,
      'jingyeInteractionProbe',
    ) as InteractionProbe;
    return {
      animations: probe.animations.map(({ record }) => record),
      pointers: probe.pointers,
      overlays: probe.overlays,
    };
  });
}

export async function settleReader(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.reader-content:not([aria-hidden="true"])')
        .length === 1 &&
      Array.from(document.querySelectorAll('.reader-content')).every((root) =>
        root
          .getAnimations()
          .every((animation) => animation.playState !== 'running'),
      ),
  );
}
