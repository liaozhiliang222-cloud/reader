import { listenMedia, mediaState, type MediaState } from '@/app/media';
import type { ReadingSettings } from '@/types';

interface MotionPage {
  root: HTMLElement;
  stride: number;
}
/** Persist the destination first; animation only affects the visual presentation. */
export class PageMotion {
  private animations: Animation[] = [];
  private cleanup?: () => void;
  private unlisten: () => void;
  private disposed = false;
  constructor(
    private reduced: MediaState = mediaState(
      '(prefers-reduced-motion: reduce)',
    ),
  ) {
    this.unlisten = listenMedia(reduced, () => this.cancel());
  }
  get enabled() {
    return !this.disposed && !this.reduced.matches;
  }
  cancel() {
    for (const animation of this.animations) {
      animation.onfinish = null;
      animation.cancel();
    }
    this.animations = [];
    this.cleanup?.();
    this.cleanup = undefined;
  }
  private track(animation: Animation) {
    // cancel() rejects finished; consume cancellation even when using onfinish.
    void animation.finished?.catch(() => {});
    this.animations.push(animation);
  }
  play(
    mode: ReadingSettings['pageAnimation'],
    previous: MotionPage,
    current: MotionPage,
    from: string,
    direction: number,
  ) {
    this.cancel();
    if (
      !this.enabled ||
      mode === 'none' ||
      typeof current.root.animate !== 'function'
    )
      return;
    const to = current.root.style.transform;
    try {
      if (mode === 'fade') {
        this.track(
          current.root.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 160,
            easing: 'ease-out',
          }),
        );
      } else {
        const options = { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' };
        if (previous === current) {
          this.track(
            current.root.animate(
              [{ transform: from }, { transform: to }],
              options,
            ),
          );
        } else {
          previous.root.style.visibility = 'visible';
          this.cleanup = () => {
            previous.root.style.visibility = 'hidden';
          };
          this.track(
            previous.root.animate(
              [
                { transform: from },
                {
                  transform: `${from} translateX(${-direction * previous.stride}px)`,
                },
              ],
              options,
            ),
          );
          this.track(
            current.root.animate(
              [
                {
                  transform: `${to} translateX(${direction * current.stride}px)`,
                },
                { transform: to },
              ],
              options,
            ),
          );
        }
      }
      const last = this.animations.at(-1)!;
      last.onfinish = () => {
        if (this.animations.at(-1) === last) this.cancel();
      };
    } catch {
      // Unsupported animation never blocks a page turn or changes its locator.
      this.cancel();
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.unlisten();
  }
}
