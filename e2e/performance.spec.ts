import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';
import { openShelf, backToShelf, menu } from './helpers';
import { updateData } from './updateData';
import { measureClick } from './paintTiming';
import { thousandChapterText } from '../src/reader/performanceFixtures';
import type { Book, StoredChapter } from '../src/types';

interface Evidence {
  errors: string[];
  external: string[];
  workers: string[];
  details: Record<string, unknown>;
}
const test = base.extend<{ evidence: Evidence }>({
  evidence: async ({ context, page, baseURL }, use, info) => {
    if (!baseURL) throw new Error('Missing preview URL');
    const origin = new URL(baseURL).origin;
    const evidence: Evidence = {
      errors: [],
      external: [],
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
      Reflect.defineProperty(window, 'jingyePeakRoots', { get: () => peak });
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
    expect(evidence.errors).toEqual([]);
    expect(evidence.external).toEqual([]);
    if (
      info.status === 'passed' ||
      info.status === 'failed' ||
      info.status === 'timedOut'
    ) {
      const runId = process.env.JINGYE_PERFORMANCE_RUN;
      if (!runId) throw new Error('Missing performance run ID');
      await writeFile(
        `.e2e-performance/${runId}/${info.project.name}-${info.title.split('：')[0]}.json`,
        JSON.stringify(
          {
            runId,
            checkedAt: new Date().toISOString(),
            engine: info.project.name,
            title: info.title,
            status: info.status,
            reducedMotion: await page.evaluate(
              () => matchMedia('(prefers-reduced-motion: reduce)').matches,
            ),
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

const active = (page: Page) =>
  page.locator('.reader-content:not([aria-hidden="true"])');
test.setTimeout(180_000);
test.use({ reducedMotion: 'no-preference' });

test('PERF-THOUSAND：原生Worker导入千章10MB原文、真实开书计时和目录末章定位', async ({
  page,
  evidence,
}) => {
  await openShelf(page);
  const buffer = Buffer.from(thousandChapterText());
  expect(buffer.length).toBeGreaterThan(10 * 1024 * 1024);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: '千章性能原创.txt',
    mimeType: 'text/plain',
    buffer,
  });
  await expect(active(page)).toHaveAttribute('data-chapter', '0', {
    timeout: 90_000,
  });
  await expect(page.locator('.reader-footer')).toHaveText(/1 \/ \d+ ·/);
  await backToShelf(page);
  const snapshot = await updateData(page);
  const books = snapshot.books as unknown as Book[];
  const chapters = snapshot.chapters as unknown as StoredChapter[];
  expect(books).toHaveLength(1);
  expect(books[0]!.chapterCount).toBe(1000);
  expect(chapters).toHaveLength(1000);
  expect(snapshot.blobs).toEqual([
    {
      id: books[0]!.fileBlobId,
      size: buffer.length,
      type: 'text/plain',
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
  ]);
  const openMs: number[] = [];
  const openStages: unknown[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    // First sample follows a full application reload; later samples reopen the
    // same stored book. Parsing/importing is deliberately outside this metric.
    if (attempt === 0) {
      await page.reload();
      await expect(
        page.getByRole('heading', { name: '我的书架' }),
      ).toBeVisible();
    }
    openMs.push(
      await measureClick(page, page.locator('.shelf-entry'), 'reader'),
    );
    openStages.push(
      await page.evaluate(() => {
        const stages: unknown = Reflect.get(window, 'jingyePaintStages');
        return stages;
      }),
    );
    await expect(active(page)).toHaveAttribute('data-chapter', '0');
    expect(await active(page).locator('[data-p]').allTextContents()).toEqual(
      chapters[0]!.paragraphs,
    );
    if (attempt < 2) await backToShelf(page);
  }
  evidence.details = {
    sourceBytes: buffer.length,
    chapterCount: chapters.length,
    openMs,
    openStages,
  };
  for (const ms of openMs)
    expect(ms, '本机原生浏览器开书应低于1500ms').toBeLessThan(1500);
  await menu(page);
  const tocMs = await measureClick(
    page,
    page.getByRole('button', { name: '目录', exact: true }),
    'toc',
  );
  evidence.details.tocMs = tocMs;
  expect(tocMs, '本机千章目录应低于300ms').toBeLessThan(300);
  const toc = page.locator('.toc-list');
  await toc.locator('button').first().focus();
  await page.keyboard.press('End');
  const last = toc.locator('[data-toc-index="999"] button');
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  const tocRows = await toc.locator('li').count();
  expect(tocRows).toBeLessThanOrEqual(24);
  await last.click();
  await expect(active(page)).toHaveAttribute('data-chapter', '999');
  await expect(page.locator('.reader-header')).toContainText('第1000章');
  expect(await active(page).locator('[data-p]').allTextContents()).toEqual(
    chapters[999]!.paragraphs,
  );
  const peakRoots: unknown = await page.evaluate(() =>
    Reflect.get(window, 'jingyePeakRoots'),
  );
  expect(peakRoots).toBeLessThanOrEqual(4);
  await backToShelf(page);
  await page.reload();
  await page.locator('.shelf-entry').click();
  await expect(active(page)).toHaveAttribute('data-chapter', '999');
  evidence.details = {
    sourceBytes: buffer.length,
    chapterCount: chapters.length,
    openMs,
    openStages,
    tocMs,
    tocRows,
    peakRoots,
    rawShaEqual: true,
    lastChapterReopened: true,
  };
});

test('PERF-SHELF：100本实际导入、首屏计时、全高度滚动和末项键盘导航', async ({
  page,
  evidence,
}) => {
  await openShelf(page);
  const files = Array.from({ length: 100 }, (_, i) => ({
    name: `百书样本${String(i + 1).padStart(3, '0')}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `第一章 静夜\n书籍${i + 1}的原创段落，用于实际导入百本书并检查虚拟书架。\n`,
    ),
  }));
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles(files);
  await expect(
    page.getByText('导入完成：100 本成功，0 本已在书架，0 本失败'),
  ).toBeVisible({ timeout: 150_000 });
  await page.getByRole('button', { name: '关闭导入面板' }).click();
  const shelf = page.getByLabel('本地书架');
  await expect(shelf).toHaveCSS('height', `${100 * 140}px`);
  const snapshot = await updateData(page);
  expect(snapshot.books).toHaveLength(100);
  expect(snapshot.chapters).toHaveLength(100);
  expect(snapshot.blobs).toHaveLength(100);
  if (!snapshot.blobs) throw new Error('Missing native Blob snapshot');
  const actualHashes = snapshot.blobs
    .map((row) => {
      if (!row || typeof row !== 'object' || !('sha256' in row))
        throw new Error('Missing Blob hash');
      return row.sha256;
    })
    .sort();
  expect(actualHashes).toEqual(
    files
      .map(({ buffer }) => createHash('sha256').update(buffer).digest('hex'))
      .sort(),
  );
  const readProbe = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jingye');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const start = performance.now();
      const cursorCount = await new Promise<number>((resolve, reject) => {
        let count = 0;
        const request = db
          .transaction('books', 'readonly')
          .objectStore('books')
          .openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(count);
            return;
          }
          count++;
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
      const cursorMs = performance.now() - start;
      const bulkStart = performance.now();
      const bulkCount = await new Promise<number>((resolve, reject) => {
        const request = db
          .transaction('books', 'readonly')
          .objectStore('books')
          .getAll();
        request.onsuccess = () => resolve(request.result.length);
        request.onerror = () => reject(request.error);
      });
      const bulkMs = performance.now() - bulkStart;
      const rafStart = performance.now();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        cursorCount,
        cursorMs,
        bulkCount,
        bulkMs,
        twoRafMs: performance.now() - rafStart,
      };
    } finally {
      db.close();
    }
  });
  expect(readProbe.cursorCount).toBe(100);
  expect(readProbe.bulkCount).toBe(100);
  const shelfMs: number[] = [];
  const shelfStages: unknown[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await shelf.locator('.shelf-entry').first().click();
    await expect(page.locator('.reader-header')).not.toBeEmpty();
    await menu(page);
    shelfMs.push(
      await measureClick(
        page,
        page.getByRole('button', { name: '返回书架', exact: true }),
        'shelf',
      ),
    );
    shelfStages.push(
      await page.evaluate(() => {
        const stages: unknown = Reflect.get(window, 'jingyePaintStages');
        return stages;
      }),
    );
    await expect(shelf).toHaveCSS('height', `${100 * 140}px`);
  }
  evidence.details = { bookCount: 100, readProbe, shelfMs, shelfStages };
  for (const ms of shelfMs)
    expect(ms, '本机百书书架首屏应低于500ms').toBeLessThan(500);
  const scroll = await shelf.evaluate(async (root) => {
    const results: {
      top: number;
      expectedStart: number;
      expectedEnd: number;
      indices: number[];
      settleMs: number;
    }[] = [];
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const shelfTop = root.getBoundingClientRect().top + scrollY;
    // Scripted native scroll through the whole list, with actual visible rows
    // checked after frame opportunities. This is not a phone touch/FPS test.
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1, 0.5, 0]) {
      const start = performance.now();
      window.scrollTo({
        top: fraction * (document.documentElement.scrollHeight - innerHeight),
        behavior: 'auto',
      });
      await nextFrame();
      await nextFrame();
      await nextFrame();
      const top = root.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor((scrollY - shelfTop) / 140));
      const end = Math.min(
        100,
        Math.ceil((scrollY + innerHeight - shelfTop) / 140),
      );
      results.push({
        top,
        expectedStart: first,
        expectedEnd: end,
        indices: Array.from(
          root.querySelectorAll<HTMLElement>('[data-shelf-index]'),
        ).map((row) => Number(row.dataset.shelfIndex)),
        settleMs: performance.now() - start,
      });
    }
    return results;
  });
  for (const sample of scroll) {
    expect(sample.indices.length).toBeLessThanOrEqual(14);
    for (let index = sample.expectedStart; index < sample.expectedEnd; index++)
      expect(sample.indices).toContain(index);
  }
  await shelf.locator('.shelf-entry').first().focus();
  await page.keyboard.press('End');
  const last = shelf.locator('[data-shelf-index="99"] .shelf-entry');
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(
    shelf.locator('[data-shelf-index="0"] .shelf-entry'),
  ).toBeFocused();
  await expect(
    shelf.locator('[data-shelf-index="0"] .shelf-entry'),
  ).toBeInViewport();
  await page.reload();
  await expect(shelf).toHaveCSS('height', `${100 * 140}px`);
  evidence.details = {
    bookCount: 100,
    nativeBlobHashesEqual: true,
    shelfMs,
    shelfStages,
    readProbe,
    scroll,
    maximumShelfRows: Math.max(
      ...scroll.map((sample) => sample.indices.length),
    ),
    keyboardEndsAndReload: true,
  };
});
