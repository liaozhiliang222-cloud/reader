import { expect, type Page } from '@playwright/test';

/** Check painted text fragments, including preformatted code/table rows. */
export async function textGeometry(page: Page) {
  const result = await page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root) => {
      const bounds = root.getBoundingClientRect(),
        frame = document
          .querySelector('.reader-viewport')!
          .getBoundingClientRect();
      const margin = parseFloat(getComputedStyle(root).marginLeft);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const issues: {
        text: string;
        tag: string | undefined;
        top: number;
        bottom: number;
        left: number;
        right: number;
      }[] = [];
      let visible = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.right <= frame.left ||
            rect.left >= frame.right
          )
            continue;
          visible++;
          if (
            rect.top < bounds.top - 1 ||
            rect.bottom > bounds.bottom + 1 ||
            rect.left < frame.left + margin - 1 ||
            rect.right > frame.right - margin + 1
          ) {
            if (issues.length < 12)
              issues.push({
                text: node.textContent?.slice(0, 100) ?? '',
                tag: node.parentElement?.tagName,
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
              });
          }
        }
      }
      return { visible, issues, top: bounds.top, bottom: bounds.bottom };
    });
  expect(result.visible).toBeGreaterThan(0);
  expect(result.issues, '当前列的每个可见文字片段须完整处于正文边界内').toEqual(
    [],
  );
}

export async function imageGeometry(page: Page) {
  const issues = await page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root) => {
      const frame = document
        .querySelector('.reader-viewport')!
        .getBoundingClientRect();
      const margin = Number.parseFloat(getComputedStyle(root).marginLeft);
      const top = root.getBoundingClientRect().top;
      const bottom = top + root.clientHeight;
      return Array.from(root.querySelectorAll('img')).flatMap((image) => {
        const rect = image.getBoundingClientRect();
        if (rect.right <= frame.left || rect.left >= frame.right) return [];
        return rect.left >= frame.left + margin - 1 &&
          rect.right <= frame.right - margin + 1 &&
          rect.top >= top - 1 &&
          rect.bottom <= bottom + 1
          ? []
          : [
              {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                margin,
                frameWidth: frame.width,
              },
            ];
      });
    });
  expect(issues, '可见图片须完整位于正文列内，不露出相邻页图片').toEqual([]);
}

/** A complete ruby in the visible column must paint every reading character. */
export async function rubyGeometry(page: Page) {
  const result = await page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root) => {
      const frame = document
        .querySelector('.reader-viewport')!
        .getBoundingClientRect();
      const margin = Number.parseFloat(getComputedStyle(root).marginLeft);
      const top = root.getBoundingClientRect().top,
        bottom = top + root.clientHeight;
      return [...root.querySelectorAll('ruby')].flatMap((ruby) => {
        const base = ruby.getBoundingClientRect();
        if (base.right <= frame.left || base.left >= frame.right) return [];
        const chars: {
          text: string;
          rects: { left: number; right: number; top: number; bottom: number }[];
        }[] = [];
        for (const rt of ruby.querySelectorAll('rt')) {
          const walker = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            let offset = 0;
            for (const text of node.textContent ?? '') {
              const range = document.createRange();
              range.setStart(node, offset);
              offset += text.length;
              range.setEnd(node, offset);
              chars.push({
                text,
                rects: [...range.getClientRects()]
                  .filter((rect) => rect.width > 0 && rect.height > 0)
                  .map(({ left, right, top, bottom }) => ({
                    left,
                    right,
                    top,
                    bottom,
                  })),
              });
            }
          }
        }
        return chars
          .filter(
            ({ rects }) =>
              !rects.length ||
              rects.some(
                (rect) =>
                  rect.left < frame.left + margin - 1 ||
                  rect.right > frame.right - margin + 1 ||
                  rect.top < top - 1 ||
                  rect.bottom > bottom + 1,
              ),
          )
          .map((char) => ({
            ...char,
            ruby: ruby.outerHTML,
            base: {
              left: base.left,
              right: base.right,
              top: base.top,
              bottom: base.bottom,
            },
            frame: {
              left: frame.left,
              right: frame.right,
              top,
              bottom,
              margin,
            },
          }));
      });
    });
  expect(result, '可见注音组的每个读音字符都应有完整行框').toEqual([]);
}
