import type { Locator, Page } from '@playwright/test';

export type PaintTarget = 'reader' | 'shelf' | 'toc';

// Test-only native clock: start in capture phase of the real click, before the
// application handler. Stop after matching laid-out DOM survives two RAFs.
// This measures a rendering opportunity, not physical display presentation.
export async function measureClick(
  page: Page,
  target: Locator,
  kind: PaintTarget,
) {
  await page.bringToFront();
  await target.evaluate((element, kind) => {
    const promise = new Promise<number>((resolve, reject) => {
      let started: number | undefined;
      let frame = 0;
      const cleanup = () => {
        clearTimeout(timeout);
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('click', click, true);
      };
      const ready = () => {
        if (kind === 'reader') {
          const root = document.querySelector<HTMLElement>(
            '.reader-content:not([aria-hidden="true"])',
          );
          const footer = document.querySelector('.reader-footer');
          const rect = root?.getBoundingClientRect();
          return (
            !!root?.querySelector('[data-p]') &&
            !!rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            !!root.style.height &&
            /\d+ \/ \d+/.test(footer?.textContent ?? '') &&
            !!document.querySelector('.reader-header')?.textContent
          );
        }
        const selector = kind === 'shelf' ? '.virtual-shelf' : '.toc-list';
        const root = document.querySelector(selector);
        const rect = root?.getBoundingClientRect();
        return (
          !!rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          Array.from(root?.querySelectorAll('li button') ?? []).some(
            (button) => {
              const row = button.getBoundingClientRect();
              return (
                row.width > 0 &&
                row.height > 0 &&
                row.bottom > 0 &&
                row.top < innerHeight
              );
            },
          )
        );
      };
      const check = () => {
        if (started === undefined || !ready() || frame) return;
        const readyMs = performance.now() - started;
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (!ready()) return;
            const ms = performance.now() - started!;
            Reflect.set(window, 'jingyePaintStages', {
              readyMs,
              afterFramesMs: ms,
              frameWaitMs: ms - readyMs,
              visibility: document.visibilityState,
            });
            cleanup();
            resolve(ms);
          });
        });
      };
      const observer = new MutationObserver(check);
      const click = (event: MouseEvent) => {
        if (!(event.target instanceof Node) || !element.contains(event.target))
          return;
        started = performance.now();
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        check();
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out measuring ${kind}`));
      }, 15_000);
      document.addEventListener('click', click, true);
    });
    Reflect.set(window, 'jingyePaintMeasurement', promise);
  }, kind);
  await target.click();
  return page.evaluate(async () => {
    const value: unknown = await Reflect.get(window, 'jingyePaintMeasurement');
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Missing native paint timing');
    Reflect.deleteProperty(window, 'jingyePaintMeasurement');
    return value;
  });
}
