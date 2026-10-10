// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { getLocator, pageOf } from './locator';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function fixture(
  html: string,
  pages: ReadonlyMap<string, readonly (number | null)[]>,
) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(24, 56, 342, 550),
  );
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    vi.spyOn(range, 'getClientRects').mockImplementation(() => {
      const page = pages.get(range.startContainer.textContent ?? '')?.[
        range.startOffset
      ];
      const rects =
        page == null ? [] : [new DOMRect(24 + page * 390, 80, 10, 32)];
      return Object.assign(rects, {
        item: (index: number) => rects[index] ?? null,
      });
    });
    return range;
  });
  return root;
}

it('段尾源换行没有字框时仍定位到本段的最后可见字符，翻页锚点可重新打开同一列', () => {
  const root = fixture(
    '<p data-p="4">前页文字\n  </p><p data-p="5">后页正文\n  </p>',
    new Map([
      ['前页文字\n  ', [0, 0, 0, 1, null, null, null]],
      ['后页正文\n  ', [1, 1, 1, 1, null, null, null]],
    ]),
  );
  const locator = getLocator(root, 1, 2, 390);
  expect(locator).toEqual({
    chapterIndex: 2,
    paragraphIndex: 4,
    charOffset: 3,
  });
  expect(pageOf(root, locator, 390)).toBe(1);
  expect(
    pageOf(root, { chapterIndex: 2, paragraphIndex: 5, charOffset: 6 }, 390),
  ).toBe(1);
  expect(root.textContent).toBe('前页文字\n  后页正文\n  ');
});

it('段首隐藏空白向后取可见字框，跨rt文本与分块起始偏移不被重写', () => {
  const root = fixture(
    '<p data-p="8" data-char-start="12000"> \n<ruby>山路<rt>やまみち</rt></ruby><em>正文</em>\n  </p>',
    new Map([
      [' \n', [null, null]],
      ['山路', [1, 1]],
      ['やまみち', [1, 1, 1, 1]],
      ['正文', [1, 2]],
      ['\n  ', [null, null, null]],
    ]),
  );
  expect(
    pageOf(
      root,
      { chapterIndex: 3, paragraphIndex: 8, charOffset: 12000 },
      390,
    ),
  ).toBe(1);
  const locator = getLocator(root, 2, 3, 390);
  expect(locator).toEqual({
    chapterIndex: 3,
    paragraphIndex: 8,
    charOffset: 12009,
  });
  expect(pageOf(root, locator, 390)).toBe(2);
  expect(root.querySelector('rt')?.textContent).toBe('やまみち');
});

it('没有文字的图片段仍以图片所在列定位', () => {
  const root = fixture('<p data-p="2"><img alt="原图" /></p>', new Map());
  vi.spyOn(root.querySelector('img')!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(414, 80, 200, 300),
  );
  const locator = getLocator(root, 1, 0, 390);
  expect(locator).toEqual({
    chapterIndex: 0,
    paragraphIndex: 2,
    charOffset: 0,
  });
  expect(pageOf(root, locator, 390)).toBe(1);
});
