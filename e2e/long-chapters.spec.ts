import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { compatibilityEpub } from '../src/parsers/epub/compatFixtures';
import { imageGeometry, rubyGeometry } from './layoutAssertions';
import type { Page, TestInfo } from '@playwright/test';
import { test as base, expect } from './fixtures';
import {
  openShelf,
  menu,
  backToShelf,
  selectVisibleText,
  setFontSize,
} from './helpers';
import { updateData } from './updateData';
import type {
  Book,
  Bookmark,
  Highlight,
  Progress,
  StoredChapter,
} from '../src/types';

interface Snapshot {
  books: Book[];
  chapters: StoredChapter[];
  progress: Progress[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
  blobs: { id: string; sha256: string; size: number; type: string }[];
}
interface Evidence {
  external: string[];
  errors: string[];
  workers: string[];
  details: Record<string, number | string | boolean>;
}
const test = base.extend<{ evidence: Evidence }>({
  evidence: async ({ context, baseURL }, use, info) => {
    if (!baseURL) throw new Error('Missing preview URL');
    const origin = new URL(baseURL).origin;
    const evidence: Evidence = {
      external: [],
      errors: [],
      workers: [],
      details: {},
    };
    const watch = (page: Page) => {
      page.on('pageerror', (error) => evidence.errors.push(error.message));
      page.on('worker', (worker) => evidence.workers.push(worker.url()));
    };
    context.pages().forEach(watch);
    context.on('page', watch);
    context.on('request', (request) => {
      if (
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== origin
      )
        evidence.external.push(request.url());
    });
    await context.addInitScript(() => {
      let peak = 0;
      Object.defineProperty(window, 'peakReadingRoots', { get: () => peak });
      const observer = new MutationObserver(() => {
        peak = Math.max(
          peak,
          document.querySelectorAll('.reader-chapters > .reader-content')
            .length,
        );
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await use(evidence);
    expect(evidence.external).toEqual([]);
    expect(evidence.errors).toEqual([]);
    if (info.status === 'passed') {
      const runId = process.env.JINGYE_LONG_RUN;
      if (!runId) throw new Error('Missing long-chapter run ID');
      await writeFile(
        `.e2e-long/${runId}/${info.project.name}-${info.title.split('：')[0]}.json`,
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            runId,
            engine: info.project.name,
            title: info.title,
            origin,
            ...evidence,
            automaticCspGuard: true,
            physicalDeviceAcceptance: false,
          },
          null,
          2,
        ) + '\n',
      );
    }
  },
});
test.setTimeout(120_000);
const active = (page: Page) =>
  page.locator('.reader-content:not([aria-hidden="true"])');

test('LONG-EPUB：跨块图片注音完整、跨段选区重排重载与备份恢复', async ({
  page,
  evidence,
}, info) => {
  const leading = '前'.repeat(11999),
    ruby = '静页jìngyè',
    end = '块首正文尾段。',
    next = '跨段后续😀文本。';
  const firstText = leading + ruby + end;
  const remaining = '尾'.repeat(120000 - firstText.length - next.length);
  const zip = await JSZip.loadAsync(
    await compatibilityEpub(
      `<p id="target"><strong>${leading}</strong><ruby><em>静</em>页<rt>jìngyè</rt></ruby><em>${end}</em><img src="original.png" alt="行内边界图"/></p><p>${next}</p><p><img src="original.png" alt="空文本图片段"/></p><p>${remaining}</p>`,
      '原创十二万字图文注音',
    ),
  );
  zip.file(
    'OPS/book.opf',
    (await zip.file('OPS/book.opf')!.async('string')).replace(
      '</manifest>',
      '<item id="image" href="original.png" media-type="image/png"/></manifest>',
    ),
  );
  zip.file('OPS/original.png', await readFile('public/icons/icon-512.png'));
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  await openShelf(page);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: '原创长篇图文.epub',
    mimeType: 'application/epub+zip',
    buffer,
  });
  await expect(active(page)).toHaveAttribute('data-chunked', 'true');
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  const imported = await snapshot(page);
  expect(imported.chapters[0]!.paragraphs).toEqual([
    firstText,
    next,
    '',
    remaining,
  ]);
  expect(imported.books[0]!.charCount).toBe(120000);
  expect(imported.blobs).toContainEqual(
    expect.objectContaining({
      sha256: createHash('sha256').update(buffer).digest('hex'),
    }),
  );
  await jumpPercent(page, 10);
  await expect(active(page)).toHaveAttribute('data-chunk', '1');
  await expect(active(page).locator('ruby')).toHaveText(ruby);
  await expect(active(page).locator('[data-p="0"]')).toHaveAttribute(
    'data-char-start',
    '11999',
  );
  await expect(active(page).locator('img')).toHaveCount(2);
  await imageGeometry(page);
  await rubyGeometry(page);
  await turn(page, '上一页');
  await expect(active(page)).toHaveAttribute('data-chunk', '0');
  await expect(active(page).locator('ruby, img')).toHaveCount(0);
  expect(await active(page).locator('[data-p="0"]').textContent()).toBe(
    leading,
  );
  await turn(page, '下一页');
  await expect(active(page)).toHaveAttribute('data-chunk', '1');
  await expect(active(page).locator('ruby')).toHaveText(ruby);
  const seenImages = new Set<string>();
  for (let index = 0; index < 3 && seenImages.size < 2; index++) {
    for (const alt of await active(page).evaluate((root) => {
      const frame = document
        .querySelector('.reader-viewport')!
        .getBoundingClientRect();
      return [...root.querySelectorAll('img')]
        .filter((image) => {
          const rect = image.getBoundingClientRect();
          return (
            image.complete &&
            image.naturalWidth > 0 &&
            rect.right > frame.left &&
            rect.left < frame.right
          );
        })
        .map((image) => image.alt);
    }))
      seenImages.add(alt);
    await imageGeometry(page);
    await rubyGeometry(page);
    await linesInsidePage(page);
    if (seenImages.size < 2) await turn(page, '下一页');
  }
  expect([...seenImages].sort()).toEqual(['空文本图片段', '行内边界图'].sort());
  await jumpPercent(page, 10);
  const domQuote = await active(page).evaluate((root) => {
    const start = root.querySelector('ruby em')!.firstChild!,
      end = root.querySelector('[data-p="1"]')!.firstChild!;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return range.toString();
  });
  expect(domQuote).toBe(ruby + end + next.slice(0, 6));
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '编辑笔记', exact: true });
  await editor.getByLabel('写下此刻的想法').fill('跨段注音图片的原创笔记');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await assertPainted(page, domQuote, true);
  await textOnlyAnnotationPaint(page);
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  evidence.details.peakRootsBeforeReload = await peakRoots(page);
  await backToShelf(page);
  const saved = await snapshot(page);
  expect(saved.highlights[0]).toMatchObject({
    start: { paragraphIndex: 0, charOffset: 11999 },
    end: { paragraphIndex: 1, charOffset: 6 },
    text: ruby + end + '\n' + next.slice(0, 6),
  });
  await resizeAndReopen(page, info, saved, domQuote);
  await expect(active(page).locator('ruby')).toHaveText(ruby);
  await imageGeometry(page);
  await rubyGeometry(page);
  await backToShelf(page);
  const beforeBackup = await snapshot(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '生成完整备份', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  const download = await downloading,
    zipPath = info.outputPath('long-epub.zip');
  await download.saveAs(zipPath);
  const archive = await JSZip.loadAsync(await readFile(zipPath), {
    checkCRC32: true,
  });
  const backup = JSON.parse(
    await archive.file('backup.json')!.async('string'),
  ) as { files: { path: string }[]; highlights: Highlight[] };
  expect(backup.highlights).toEqual(saved.highlights);
  expect(
    Buffer.from(await archive.file(backup.files[0]!.path)!.async('uint8array')),
  ).toEqual(buffer);
  await page.getByRole('button', { name: '清空所有数据', exact: true }).click();
  await page.getByLabel('请输入“清空”确认').fill('清空');
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(
    page.getByText('本地数据已清空。', { exact: true }),
  ).toBeVisible();
  await page
    .locator('input[type="file"][accept*=".zip"]')
    .setInputFiles(zipPath);
  await page.getByRole('button', { name: '合并恢复', exact: true }).click();
  await expect(
    page.getByText('恢复完成。书架共 1 本。', { exact: true }),
  ).toBeVisible();
  const restored = await snapshot(page);
  for (const name of [
    'chapters',
    'highlights',
    'bookmarks',
    'progress',
  ] as const)
    expect(restored[name]).toEqual(beforeBackup[name]);
  const originalBytes = (data: Snapshot) =>
    data.blobs.map(({ id, size, sha256 }) => ({ id, size, sha256 }));
  expect(originalBytes(restored)).toEqual(originalBytes(beforeBackup));
  expect(
    restored.blobs.filter((blob) => blob.type.startsWith('image/')),
  ).toEqual(
    beforeBackup.blobs.filter((blob) => blob.type.startsWith('image/')),
  );
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.locator('.shelf-entry').click();
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: /笔记/ }).click();
  await page.locator('.note-jump').click();
  await assertPainted(page, domQuote, true);
  await expect(active(page).locator('ruby')).toHaveText(ruby);
  await expect(active(page).locator('img')).toHaveCount(2);
  await linesInsidePage(page);
  await imageGeometry(page);
  await rubyGeometry(page);
  evidence.details = {
    ...evidence.details,
    sourceChars: 120000,
    rubyCompleteAtBoundary: true,
    textOnlyAnnotationPaint: true,
    bothImagesDecodedAndSeen: true,
    crossParagraphUtf16SpanRetained: true,
    linesInsidePage: true,
    persistedContentAndAnnotationsEqual: true,
    noteJumpVisibleAfterReloadAndResize: true,
    originalZipAndRestoredShaEqual: true,
    peakRootsAfterReload: await peakRoots(page),
  };
  await mkdir('test-books/long-chapter-evidence', { recursive: true });
  await page.screenshot({
    path: `test-books/long-chapter-evidence/${info.project.name}-LONG-EPUB-boundary.png`,
  });
});
async function snapshot(page: Page) {
  const value = await updateData(page);
  for (const key of [
    'books',
    'chapters',
    'progress',
    'bookmarks',
    'highlights',
    'blobs',
  ])
    expect(Array.isArray(value[key])).toBe(true);
  return value as unknown as Snapshot;
}
async function importText(page: Page, text: string, title: string) {
  await openShelf(page);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  const buffer = Buffer.from(`第一章 ${title}\n\n${text}`);
  await page
    .getByLabel('选择书籍文件')
    .setInputFiles({ name: `${title}.txt`, mimeType: 'text/plain', buffer });
  await expect(active(page)).toHaveAttribute('data-chunked', 'true');
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  const data = await snapshot(page);
  expect(data.books[0]!.chapterCount).toBe(1);
  expect(data.blobs[0]!.sha256).toBe(
    createHash('sha256').update(buffer).digest('hex'),
  );
  return data;
}
async function jumpPercent(page: Page, percent: number) {
  await menu(page);
  const slider = page.getByRole('slider', { name: /阅读进度/ });
  await expect(slider).toBeEnabled();
  // Exercise the actual input/commit handlers; no direct engine or IDB write.
  await slider.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, percent);
  await expect
    .poll(async () =>
      Number.parseFloat((await slider.getAttribute('aria-valuetext')) ?? ''),
    )
    .toBe(percent);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
}
async function turn(page: Page, direction: '下一页' | '上一页') {
  await menu(page);
  const before = await active(page).evaluate(
    (root) => `${root.dataset.chunk}/${root.style.transform}`,
  );
  await page.getByRole('button', { name: direction, exact: true }).click();
  await expect
    .poll(() =>
      active(page).evaluate(
        (root) => `${root.dataset.chunk}/${root.style.transform}`,
      ),
    )
    .not.toBe(before);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
}
async function linesInsidePage(page: Page) {
  const result = await active(page).evaluate((root) => {
    const frame = document
      .querySelector('.reader-viewport')!
      .getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    const bottom = bounds.top + root.clientHeight;
    const margin = Number.parseFloat(getComputedStyle(root).marginLeft);
    const visible: DOMRect[] = [];
    for (const p of root.querySelectorAll('[data-p]')) {
      const range = document.createRange();
      range.selectNodeContents(p);
      visible.push(
        ...Array.from(range.getClientRects()).filter(
          (rect) =>
            rect.width > 0 &&
            rect.right > frame.left &&
            rect.left < frame.right,
        ),
      );
    }
    return {
      count: visible.length,
      issues: visible
        .filter(
          (rect) =>
            rect.top < bounds.top - 1 ||
            rect.bottom > bottom + 1 ||
            rect.left < frame.left + margin - 1 ||
            rect.right > frame.right - margin + 1,
        )
        .map((rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        })),
    };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.issues, '可见文字行框须完整位于正文列内').toEqual([]);
}
async function addNoteAndBookmark(page: Page) {
  const excerpt = await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '编辑笔记', exact: true });
  await editor.getByLabel('写下此刻的想法').fill('长章真实分块笔记');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  return excerpt;
}
async function assertPainted(page: Page, excerpt: string, visible = false) {
  await expect
    .poll(() =>
      active(page).evaluate(
        (root, { text, visible }) => {
          const frame = document
            .querySelector('.reader-viewport')!
            .getBoundingClientRect();
          const matches = (range: Range) =>
            root.contains(range.startContainer) &&
            range.toString() === text &&
            (!visible ||
              Array.from(range.getClientRects()).some(
                (rect) =>
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.right > frame.left &&
                  rect.left < frame.right &&
                  rect.bottom > frame.top &&
                  rect.top < frame.bottom,
              ));
          const marks = Array.from(
            root.querySelectorAll('mark[data-jingye-highlight]'),
          ).map((mark) => {
            const range = document.createRange();
            range.selectNodeContents(mark);
            return range;
          });
          const ranges = ['red', 'blue', 'yellow'].flatMap((color) =>
            Array.from(CSS.highlights?.get(`jingye-${color}`) ?? []),
          );
          const painted = marks.length
            ? marks
            : ranges.filter(
                (range): range is Range =>
                  range instanceof Range && root.contains(range.startContainer),
              );
          const combined =
            painted.map((range) => range.toString()).join('') === text &&
            (!visible ||
              painted.some((range) =>
                [...range.getClientRects()].some(
                  (rect) =>
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.right > frame.left &&
                    rect.left < frame.right &&
                    rect.bottom > frame.top &&
                    rect.top < frame.bottom,
                ),
              ));
          return (
            marks.some(matches) ||
            ranges.some((range) => range instanceof Range && matches(range)) ||
            combined
          );
        },
        { text: excerpt, visible },
      ),
    )
    .toBe(true);
}
async function textOnlyAnnotationPaint(page: Page) {
  await expect(active(page).locator('ruby rt mark')).toHaveText('jìngyè');
  const paint = await active(page).evaluate((root) => ({
    imagesWrapped: [...root.querySelectorAll('img')].some(
      (image) => !!image.closest('mark'),
    ),
    nonTextMarks: [
      ...root.querySelectorAll('mark[data-jingye-highlight]'),
    ].some((mark) =>
      [...mark.childNodes].some((node) => node.nodeType !== Node.TEXT_NODE),
    ),
    nativeRanges: ['red', 'blue', 'yellow', 'focus']
      .flatMap((color) => [...(CSS.highlights?.get('jingye-' + color) ?? [])])
      .filter(
        (range) =>
          range instanceof Range && root.contains(range.startContainer),
      ).length,
  }));
  expect(paint).toEqual({
    imagesWrapped: false,
    nonTextMarks: false,
    nativeRanges: 0,
  });
}
async function exitFullscreen(page: Page) {
  if (!(await page.evaluate(() => !!document.fullscreenElement))) return;
  await menu(page);
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
}
async function expectRootHeight(page: Page, height: number) {
  await expect
    .poll(() =>
      active(page).evaluate((root) => Number.parseFloat(root.style.height)),
    )
    .toBe(height);
  // Chromium quantizes computed layout to 1/64 CSS px. Keep the model exact
  // and permit only one layout unit, while checking actual line boxes below.
  await expect
    .poll(() =>
      active(page).evaluate(
        (root, expected) =>
          Math.abs(Number.parseFloat(getComputedStyle(root).height) - expected),
        height,
      ),
    )
    .toBeLessThanOrEqual(1 / 64);
}
async function resizeAndReopen(
  page: Page,
  info: TestInfo,
  saved: Snapshot,
  excerpt: string,
) {
  await page.locator('.shelf-entry').click();
  await menu(page);
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await setFontSize(page, 28);
  await expect(active(page)).toHaveCSS('font-size', '28px');
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await exitFullscreen(page);
  await linesInsidePage(page);
  await assertPainted(page, excerpt);
  await imageGeometry(page);
  await rubyGeometry(page);
  const portrait = page.viewportSize()!;
  await page.setViewportSize({
    width: portrait.height,
    height: portrait.width,
  });
  const line = 28 * 1.8;
  await expectRootHeight(
    page,
    Math.floor((portrait.width - 112) / line) * line,
  );
  await linesInsidePage(page);
  await assertPainted(page, excerpt);
  await imageGeometry(page);
  await rubyGeometry(page);
  await mkdir('test-books/long-chapter-evidence', { recursive: true });
  await page.screenshot({
    path: `test-books/long-chapter-evidence/${info.project.name}-${info.title.split('：')[0]}-landscape.png`,
  });
  await backToShelf(page);
  const after = await snapshot(page);
  expect(after.progress[0]!.locator).toEqual(saved.progress[0]!.locator);
  expect(after.highlights).toEqual(saved.highlights);
  expect(after.bookmarks).toEqual(saved.bookmarks);
  expect(after.blobs).toEqual(saved.blobs);
  expect(after.chapters).toEqual(saved.chapters);
  await page.reload();
  await page.locator('.shelf-entry').click();
  await expect(active(page)).toHaveCSS('font-size', '28px');
  await assertPainted(page, excerpt);
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: /笔记/ }).click();
  await page.locator('.note-jump').click();
  await assertPainted(page, excerpt, true);
  await linesInsidePage(page);
  await imageGeometry(page);
  await rubyGeometry(page);
  await exitFullscreen(page);
  await page.setViewportSize(portrait);
  await expectRootHeight(
    page,
    Math.floor((portrait.height - 112) / line) * line,
  );
  await linesInsidePage(page);
  await assertPainted(page, excerpt, true);
  await imageGeometry(page);
  await rubyGeometry(page);
  await page.screenshot({
    path: `test-books/long-chapter-evidence/${info.project.name}-${info.title.split('：')[0]}-note-jump.png`,
  });
}
async function peakRoots(page: Page) {
  const peak = await page.evaluate(() => {
    const value: unknown = Reflect.get(window, 'peakReadingRoots');
    if (typeof value !== 'number') throw new Error('Missing DOM observer');
    return value;
  });
  // Current + two adjacent blocks, plus one temporary idle measurement.
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
  return peak;
}

test('LONG-SINGLE：12万字单段跨块往返、UTF-16定位和字号窗口变化后标注保留', async ({
  page,
  evidence,
}, info) => {
  const text = (
    '😀' +
    Array.from(
      { length: 8000 },
      (_, i) => `第${String(i).padStart(5, '0')}句，风穿过微光阅读的窗户。`,
    ).join('')
  ).slice(0, 120001);
  const imported = await importText(page, text, '十二万字长段');
  expect(imported.chapters[0]!.paragraphs).toEqual([text]);
  await jumpPercent(page, 10);
  await expect(active(page)).toHaveAttribute('data-chunk', '1');
  const first = await active(page)
    .locator('[data-p]')
    .evaluate((p) => ({
      start: Number(p.dataset.charStart ?? 0),
      text: p.textContent!,
    }));
  expect(first.start).toBe(12000);
  expect(first.text).toBe(
    text.slice(first.start, first.start + first.text.length),
  );
  await turn(page, '上一页');
  await expect(active(page)).toHaveAttribute('data-chunk', '0');
  const preceding = await active(page).locator('[data-p]').textContent();
  expect(preceding!.length).toBe(first.start);
  expect(preceding).toBe(text.slice(0, first.start));
  await linesInsidePage(page);
  await turn(page, '下一页');
  await expect(active(page)).toHaveAttribute('data-chunk', '1');
  await linesInsidePage(page);
  const excerpt = await addNoteAndBookmark(page);
  evidence.details.peakRootsBeforeReload = await peakRoots(page);
  await backToShelf(page);
  const saved = await snapshot(page);
  const note = saved.highlights[0]!;
  expect(note.start.paragraphIndex).toBe(0);
  expect(note.start.charOffset).toBeGreaterThanOrEqual(first.start);
  expect(text.slice(note.start.charOffset, note.end.charOffset)).toBe(excerpt);
  expect(saved.bookmarks[0]!.locator).toEqual({
    chapterIndex: 0,
    paragraphIndex: 0,
    charOffset: first.start,
  });
  await resizeAndReopen(page, info, saved, excerpt);
  evidence.details = {
    ...evidence.details,
    sourceChars: text.length,
    paragraphCount: 1,
    boundaryOffset: first.start,
    linesInsidePage: true,
    persistedContentAndAnnotationsEqual: true,
    noteJumpVisibleAfterReloadAndResize: true,
    peakRootsAfterReload: await peakRoots(page),
  };
});

test('LONG-MANY：千段长章后半部定位、原段落编号、重排重载与笔记跳转', async ({
  page,
  evidence,
}, info) => {
  const paragraphs = Array.from(
    { length: 1000 },
    (_, i) =>
      `第${String(i).padStart(4, '0')}段，` +
      '这段原创文字用来确认长章节分块不会改动原段落编号。'.repeat(6),
  );
  const imported = await importText(
    page,
    paragraphs.join('\n\n'),
    '千段长章节',
  );
  expect(imported.chapters[0]!.paragraphs).toEqual(paragraphs);
  await jumpPercent(page, 55);
  await expect
    .poll(() => active(page).getAttribute('data-chunk'))
    .not.toBe('0');
  const rendered = await active(page)
    .locator('[data-p]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        index: Number((node as HTMLElement).dataset.p),
        text: node.textContent,
      })),
    );
  expect(rendered.length).toBeLessThanOrEqual(128);
  expect(rendered[0]!.index).toBeGreaterThan(400);
  for (const row of rendered) expect(row.text).toBe(paragraphs[row.index]);
  await linesInsidePage(page);
  const excerpt = await addNoteAndBookmark(page);
  evidence.details.peakRootsBeforeReload = await peakRoots(page);
  await backToShelf(page);
  const saved = await snapshot(page);
  const note = saved.highlights[0]!;
  expect(note.start.paragraphIndex).toBeGreaterThan(500);
  expect(note.start.paragraphIndex).toBe(note.end.paragraphIndex);
  expect(
    paragraphs[note.start.paragraphIndex]!.slice(
      note.start.charOffset,
      note.end.charOffset,
    ),
  ).toBe(excerpt);
  await resizeAndReopen(page, info, saved, excerpt);
  evidence.details = {
    ...evidence.details,
    sourceChars: imported.books[0]!.charCount,
    paragraphCount: paragraphs.length,
    selectedParagraph: note.start.paragraphIndex,
    linesInsidePage: true,
    persistedContentAndAnnotationsEqual: true,
    noteJumpVisibleAfterReloadAndResize: true,
    peakRootsAfterReload: await peakRoots(page),
  };
});
