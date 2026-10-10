import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { openShelf, menu, backToShelf } from './helpers';
import sources from '../scripts/real-epub-sources.json' with { type: 'json' };
import { updateData } from './updateData';
import { imageGeometry, textGeometry } from './layoutAssertions';

for (const source of sources) {
  const file = resolve('test-books/real-epubs', `${source.id}.epub`);
  test(`${source.title} [${source.id}]: 真实原文件导入、目录跳转、翻页与重载`, async ({
    page,
  }, info) => {
    test.skip(!existsSync(file), '官方文件尚未下载；不以合成书替代');
    const reports = process.env.JINGYE_COMPAT_RUN;
    if (!reports) throw new Error('Missing compatibility run');
    const run = JSON.parse(
      await readFile('artifacts/compatibility-run.json', 'utf8'),
    ) as {
      runId: string;
      reports: string;
      startedAt: string;
      sourceSha256: string;
    };
    expect(reports).toBe(run.reports);
    expect(source.inspectionStatus).toBe('original-source-reviewed');
    expect(source.bodyContains.length).toBeGreaterThan(0);
    const bytes = await readFile(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const metadata: unknown = JSON.parse(
      await readFile(file.replace(/\.epub$/, '.json'), 'utf8'),
    );
    expect(metadata).toEqual(
      expect.objectContaining({ sha256, download: source.download }),
    );
    const errors: string[] = [],
      external: string[] = [],
      workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4180/'))
        external.push(url);
    });
    await openShelf(page);
    await page.getByRole('button', { name: '设置与数据管理' }).click();
    await page.getByLabel('进入阅读时显示安静提示').uncheck();
    await page.getByRole('button', { name: '返回书架', exact: true }).click();
    await page.getByRole('button', { name: '导入第一本书' }).click();
    await page.getByLabel('选择书籍文件').setInputFiles(file);
    await expect(page.locator('.reader-footer')).toBeVisible({
      timeout: 90_000,
    });
    const root = page.locator('.reader-content:not([aria-hidden="true"])');
    if (source.id === 'gutenberg-24113') {
      await expect(root.locator('img')).toHaveCount(1);
      await expect
        .poll(() =>
          root
            .locator('img')
            .evaluate(
              (img) =>
                img instanceof HTMLImageElement &&
                img.complete &&
                img.naturalWidth > 0,
            ),
        )
        .toBe(true);
      await imageGeometry(page);
      await page.screenshot({
        path: info.outputPath('real-svg-wrapped-cover.png'),
      });
    }
    const heading = await jumpToSection(
      page,
      source.tocTitle,
      source.tocOccurrence,
    );
    await showBodyText(page, source.bodyContains);
    await imageGeometry(page);
    const bodyScreenshots: { kind: string; path: string; sha256: string }[] =
      [];
    const screenshotBody = async (kind: string) => {
      const path = join(
        reports,
        info.project.name + '-' + source.id + '-' + kind + '.png',
      );
      await page.screenshot({ path });
      await textGeometry(page);
      bodyScreenshots.push({
        kind,
        path,
        sha256: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      });
    };
    await screenshotBody('body');
    if (source.id === 'idpf-kusamakura') {
      await expect(root.locator('ruby rt').first()).toHaveText('やまみち');
      await expect(root).toHaveCSS('writing-mode', 'horizontal-tb');
    }
    if (source.id === 'eloquent-javascript') {
      await expect(root.locator('img')).not.toHaveCount(0);
      await expect
        .poll(() =>
          root
            .locator('img')
            .evaluateAll((imgs) =>
              imgs.every(
                (img) =>
                  img instanceof HTMLImageElement &&
                  img.complete &&
                  img.naturalWidth > 0,
              ),
            ),
        )
        .toBe(true);
    }
    await imageGeometry(page);
    for (const probe of source.additionalProbes) {
      await jumpToSection(page, probe.tocTitle);
      await showBodyText(page, probe.bodyContains);
      await imageGeometry(page);
      await screenshotBody(probe.kind);
    }
    await menu(page);
    const beforeTurn = await page.locator('.reader-footer').innerText();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.reader-footer')).not.toHaveText(beforeTurn);
    await page.getByRole('button', { name: '继续阅读', exact: true }).click();
    await imageGeometry(page);
    const footer = await page.locator('.reader-footer').innerText();
    const positionBeforeReload = await readerPosition(page);
    await backToShelf(page);
    const savedProgress = (await updateData(page)).progress;
    await page.reload();
    // The explicit #/ shelf route takes precedence over automatic resume.
    await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
    await page.locator('.shelf-entry').click();
    await expect(root).toBeVisible();
    await info.attach('续读定位诊断', {
      body: JSON.stringify({
        positionBeforeReload,
        savedProgress,
        reopened: await readerPosition(page),
      }),
      contentType: 'application/json',
    });
    await expect(page.locator('.reader-footer')).toHaveText(footer);
    await imageGeometry(page);
    const data = await updateData(page);
    expect(data.books).toHaveLength(1);
    expect(data.books?.[0]).toEqual(
      expect.objectContaining({ parserVersion: 3 }),
    );
    const svgAssets =
      data.blobs?.filter(
        (row) =>
          row &&
          typeof row === 'object' &&
          'type' in row &&
          row.type === 'image/svg+xml',
      ).length ?? 0;
    if (source.id === 'eloquent-javascript') expect(svgAssets).toBe(21);
    expect(data.blobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sha256, sha256, size: bytes.byteLength }),
      ]),
    );
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(workers.length).toBeGreaterThan(0);
    for (const worker of workers)
      expect(new URL(worker).origin).toBe('http://127.0.0.1:4180');
    await mkdir(reports, { recursive: true });
    const screenshot = join(reports, `${info.project.name}-${source.id}.png`);
    await page.screenshot({ path: screenshot });
    const report = {
      runId: run.runId,
      startedAt: run.startedAt,
      sourceSha256: run.sourceSha256,
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      sourcePage: source.page,
      sha256,
      bytes: bytes.byteLength,
      engine: info.project.name,
      checkedAt: new Date().toISOString(),
      realWorkerImport: true,
      workers,
      automaticCspGuard: true,
      nativeIndexedDb: true,
      bodyContains: source.bodyContains,
      bodyTextActuallyVisible: true,
      tocOccurrence: source.tocOccurrence,
      bodyScreenshots,
      additionalBodyProbes: source.additionalProbes,
      sourceFeatures: source.features,
      sourceVerticalWriting: source.id === 'idpf-kusamakura',
      uniformHorizontalLayout: source.id === 'idpf-kusamakura',
      parserVersion: 3,
      svgAssets,
      tocSection: heading,
      progressReloaded: footer,
      savedProgress,
      rawFileHashPreserved: true,
      imageBoundsChecked: true,
      textBoundsChecked: true,
      externalRequests: external,
      pageErrors: errors,
      screenshot,
      visualReview: 'pending',
      physicalDeviceAcceptance: false,
    };
    await writeFile(
      join(reports, `${info.project.name}-${source.id}.json`),
      JSON.stringify(report, null, 2) + '\n',
    );
    await info.attach('真实EPUB验收', {
      body: JSON.stringify(report),
      contentType: 'application/json',
    });
  });
}

async function readerPosition(page: Page) {
  return page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root) => {
      const rect = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      const stride = rect.width + parseFloat(style.columnGap);
      return {
        root: rect.toJSON(),
        stride,
        footer: document.querySelector('.reader-footer')?.textContent,
        paragraphs: [...root.querySelectorAll('[data-p]')]
          .slice(0, 20)
          .map((p) => {
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            const chars: { offset: number; text: string; page: number }[] = [];
            let offset = 0;
            while (walker.nextNode()) {
              const node = walker.currentNode;
              for (
                let start = 0;
                start < (node.textContent?.length ?? 0);
                start++
              ) {
                const r = document.createRange();
                r.setStart(node, start);
                r.setEnd(node, start + 1);
                chars.push({
                  offset: offset + start,
                  text: r.toString(),
                  page: Math.floor(
                    (r.getBoundingClientRect().left - rect.left + 1) / stride,
                  ),
                });
              }
              offset += node.textContent?.length ?? 0;
            }
            return {
              p: p.getAttribute('data-p'),
              start: p.getAttribute('data-char-start'),
              text: p.textContent?.slice(0, 60),
              firstOnPages: chars.filter(
                (c, i) => !i || c.page !== chars[i - 1]?.page,
              ),
            };
          }),
      };
    });
}

async function jumpToSection(page: Page, title: string, occurrence = 0) {
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const contents = await updateData(page),
    book = contents.books?.[0];
  if (
    !book ||
    typeof book !== 'object' ||
    !('toc' in book) ||
    !Array.isArray(book.toc)
  )
    throw new Error('Missing real book TOC');
  let seen = 0;
  const targetIndex = book.toc.findIndex((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('title' in entry) ||
      entry.title !== title
    )
      return false;
    return seen++ === occurrence;
  });
  expect(
    targetIndex,
    'Source-inspected body section must exist in the actual TOC',
  ).toBeGreaterThanOrEqual(0);
  const entries = page.locator('[data-toc-index] button');
  await entries.first().focus();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-toc-index="0"] button')).toBeFocused();
  for (let index = 0; index < targetIndex; index++) {
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('[data-toc-index="' + (index + 1) + '"] button'),
    ).toBeFocused();
  }
  const selected = page.locator(
    '[data-toc-index="' + targetIndex + '"] button',
  );
  const heading = await selected.innerText();
  expect(heading).toBe(title);
  await selected.click();
  await expect(
    page.getByRole('dialog', { name: '目录、书签与笔记' }),
  ).toHaveCount(0);
  await expect(
    page.locator('.reader-content:not([aria-hidden="true"])'),
  ).toBeVisible();
  await expect(page.locator('.reader-header')).toHaveText(heading);
  return heading;
}
async function bodyTextVisible(page: Page, text: string) {
  return page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root, text) => {
      const frame = document
        .querySelector('.reader-viewport')!
        .getBoundingClientRect();
      for (const paragraph of root.querySelectorAll('[data-p]')) {
        const start = (paragraph.textContent ?? '').indexOf(text);
        if (start < 0) continue;
        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT,
        );
        const range = document.createRange();
        let offset = 0,
          started = false;
        while (walker.nextNode()) {
          const node = walker.currentNode,
            length = node.textContent?.length ?? 0;
          if (!started && start < offset + length) {
            range.setStart(node, start - offset);
            started = true;
          }
          if (started && start + text.length <= offset + length) {
            range.setEnd(node, start + text.length - offset);
            break;
          }
          offset += length;
        }
        if (!started || range.toString() !== text) continue;
        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        if (
          rects.length &&
          rects.every(
            (rect) =>
              rect.left >= frame.left - 1 &&
              rect.right <= frame.right + 1 &&
              rect.top >= frame.top - 1 &&
              rect.bottom <= frame.bottom + 1,
          )
        )
          return true;
      }
      return false;
    }, text);
}
async function showBodyText(page: Page, text: string) {
  for (let turn = 0; turn < 24; turn++) {
    if (await bodyTextVisible(page, text)) {
      const resume = page.getByRole('button', {
        name: '继续阅读',
        exact: true,
      });
      if (await resume.isVisible()) await resume.click();
      await expect(page.locator('.reader-menu')).toHaveCount(0);
      return;
    }
    await imageGeometry(page);
    await menu(page);
    const before = await page.locator('.reader-footer').innerText();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.reader-footer')).not.toHaveText(before);
  }
  expect(
    await bodyTextVisible(page, text),
    'Preselected original body text must actually appear in the reader viewport',
  ).toBe(true);
}
