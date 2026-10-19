import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test as base, expect } from './fixtures';
import {
  importBook,
  nextPage,
  selectVisibleText,
  menu,
  backToShelf,
} from './helpers';
import { updateServer } from './updateServer';
import { updateData } from './updateData';

const test = base.extend<{
  updateHost: Awaited<ReturnType<typeof updateServer>>;
}>({
  updateHost: async ({ context }, use) => {
    const host = await updateServer();
    const errors: string[] = [];
    const observe = (page: Page) =>
      page.on('pageerror', (error) => errors.push(error.message));
    context.pages().forEach(observe);
    context.on('page', observe);
    try {
      await use(host);
      expect(errors).toEqual([]);
    } finally {
      context.off('page', observe);
      await host.close();
    }
  },
});
async function start(
  page: Page,
  host: Awaited<ReturnType<typeof updateServer>>,
) {
  await page.clock.install();
  await page.addInitScript(() => {
    Reflect.set(window, 'updateDocumentId', crypto.randomUUID());
  });
  await page.goto(host.url + '/');
  await page.getByRole('button', { name: '跳过引导' }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByLabel('启动时继续上次阅读').uncheck();
  await page.getByLabel('进入阅读时显示安静提示').uncheck();
  await page.getByRole('button', { name: '关于微光阅读与隐私' }).click();
  await expect(
    page.getByText(`版本 ${host.manifest.a.version}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回设置' }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await importBook(page, 'txt');
  await nextPage(page, 2);
  await nextPage(page, 3);
  const quote = await selectVisibleText(page);
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.getByLabel('写下此刻的想法').fill('版本更新应保留这条原创笔记。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑笔记' })).toHaveCount(0);
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await expect(page.getByRole('button', { name: '移除书签' })).toBeVisible();
  const footer = await page.locator('.reader-footer').innerText();
  await backToShelf(page);
  return { quote, footer };
}
const main = (page: Page) =>
  page.locator('script[type="module"][src]').getAttribute('src');
const documentId = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'updateDocumentId') as string);
async function progressTime(page: Page) {
  const progress = (await updateData(page)).progress?.[0];
  if (
    !progress ||
    typeof progress !== 'object' ||
    !('updatedAt' in progress) ||
    typeof progress.updatedAt !== 'number'
  )
    throw new Error('Expected persisted reading progress');
  return progress.updatedAt;
}
async function waiting(page: Page) {
  return page.evaluate(
    async () =>
      (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null,
  );
}
async function updated(
  page: Page,
  host: Awaited<ReturnType<typeof updateServer>>,
) {
  const oldDocument = await documentId(page);
  await page.getByRole('button', { name: '点击更新', exact: true }).click();
  await expect.poll(() => main(page)).toBe(host.manifest.b.main);
  await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
  expect(await documentId(page)).not.toBe(oldDocument);
  expect(await waiting(page)).toBeNull();
}
async function evidence(
  info: TestInfo,
  host: Awaited<ReturnType<typeof updateServer>>,
  scenario: string,
  before: Record<string, unknown[]>,
  after: Record<string, unknown[]>,
  extra: Record<string, unknown>,
) {
  const hash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const report = {
    engine: info.project.name,
    scenario,
    checkedAt: new Date().toISOString(),
    versions: { a: host.manifest.a.version, b: host.manifest.b.version },
    builds: {
      a: host.manifest.a.serviceWorkerSha256,
      b: host.manifest.b.serviceWorkerSha256,
    },
    mainChunks: { a: host.manifest.a.main, b: host.manifest.b.main },
    nativeIdbTablesEqual: true,
    beforeSha256: hash(before),
    afterSha256: hash(after),
    tableCounts: Object.fromEntries(
      Object.entries(before).map(([name, rows]) => [name, rows.length]),
    ),
    originalBlobs: before.blobs,
    ...extra,
  };
  const bytes = JSON.stringify(report, null, 2) + '\n';
  await writeFile(
    join(host.manifest.reports, `${info.project.name}-${scenario}.json`),
    bytes,
  );
  await info.attach('两版本更新证据', {
    body: bytes,
    contentType: 'application/json',
  });
}

test('新版本后台下载时阅读不刷新，回书架显式更新并完整保留七张表', async ({
  page,
  updateHost,
}, info) => {
  const { quote, footer } = await start(page, updateHost);
  await page.locator('.shelf-entry').click();
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await menu(page);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  const oldDocument = await documentId(page);
  expect(await main(page)).toBe(updateHost.manifest.a.main);
  updateHost.deployB();
  // Advance only the window's timers; SW installation and HTTP remain real.
  await page.clock.fastForward(61 * 60 * 1000);
  await expect.poll(() => waiting(page)).toBe('installed');
  expect(await documentId(page)).toBe(oldDocument);
  expect(await main(page)).toBe(updateHost.manifest.a.main);
  await expect(
    page.getByRole('button', { name: '点击更新', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await backToShelf(page);
  await expect(
    page.getByRole('button', { name: '点击更新', exact: true }),
  ).toBeVisible();
  const before = await updateData(page);
  expect(before.books).toHaveLength(1);
  expect(before.bookmarks).toHaveLength(1);
  expect(before.highlights).toEqual([
    expect.objectContaining({
      text: quote,
      note: '版本更新应保留这条原创笔记。',
    }),
  ]);
  await updated(page, updateHost);
  const after = await updateData(page);
  expect(after).toEqual(before);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await expect(page.getByLabel('启动时继续上次阅读')).not.toBeChecked();
  await page.getByRole('button', { name: '关于微光阅读与隐私' }).click();
  await expect(
    page.getByText(`版本 ${updateHost.manifest.b.version}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回设置' }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.locator('.shelf-entry').click();
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await menu(page);
  await expect(page.getByRole('button', { name: '移除书签' })).toBeVisible();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(
    page.getByText('版本更新应保留这条原创笔记。', { exact: true }),
  ).toBeVisible();
  expect(
    updateHost.requests.some(
      (request) =>
        request.path === updateHost.manifest.b.main && request.status === 200,
    ),
  ).toBe(true);
  await evidence(info, updateHost, 'automatic-wait-click', before, after, {
    oldReaderDocumentPreserved: true,
    newVersionRendered: true,
    progressAndNotesReopened: true,
  });
});

test('关闭自动检查保留设置，手动检查下载失败不破坏旧版，修复后可再次更新', async ({
  page,
  updateHost,
}, info) => {
  await start(page, updateHost);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByLabel('自动检查应用更新').uncheck();
  await expect(page.getByLabel('自动检查应用更新')).not.toBeChecked();
  await expect
    .poll(async () => {
      const records = (await updateData(page)).settings;
      return (
        records?.[0] as { value?: { checkUpdates?: boolean } } | undefined
      )?.value?.checkUpdates;
    })
    .toBe(false);
  const oldDocument = await documentId(page),
    oldRequests = updateHost.requests.filter(
      (request) => request.path === '/sw.js',
    ).length;
  updateHost.deployB(true);
  await page.clock.fastForward(2 * 60 * 60 * 1000);
  expect(
    updateHost.requests.filter((request) => request.path === '/sw.js'),
  ).toHaveLength(oldRequests);
  expect(await waiting(page)).toBeNull();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(
    page.getByText('新版本资源尚未下载完整，稍后会再检查。', { exact: true }),
  ).toBeVisible();
  expect(
    updateHost.requests.some(
      (request) =>
        request.path === updateHost.manifest.b.main && request.status === 503,
    ),
  ).toBe(true);
  expect(await documentId(page)).toBe(oldDocument);
  expect(await main(page)).toBe(updateHost.manifest.a.main);
  expect(await waiting(page)).toBeNull();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '点击更新', exact: true }),
  ).toHaveCount(0);
  const before = await updateData(page);
  updateHost.deployB();
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(
    page.getByText('新版本已下载，返回书架即可更新。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await updated(page, updateHost);
  const after = await updateData(page);
  expect(after).toEqual(before);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await expect(page.getByLabel('自动检查应用更新')).not.toBeChecked();
  await evidence(info, updateHost, 'disabled-failure-retry', before, after, {
    windowTimersAdvancedHours: 2,
    noProactiveSwFetch: true,
    failedDownloadObserved: true,
    oldVersionStayedUsable: true,
    manualRetrySucceeded: true,
    disabledPreferencePreserved: true,
  });
});

test('另一标签更新后旧阅读页保持原文与进度，仍能继续翻页', async ({
  page,
  context,
  updateHost,
}, info) => {
  const { footer } = await start(page, updateHost);
  const priorProgressTime = await progressTime(page);
  await page.locator('.shelf-entry').click();
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await menu(page);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  const oldDocument = await documentId(page);
  const shelf = await context.newPage();
  await shelf.addInitScript(() => {
    Reflect.set(window, 'updateDocumentId', crypto.randomUUID());
  });
  await shelf.goto(updateHost.url + '/#/');
  await expect(shelf.getByRole('heading', { name: '我的书架' })).toBeVisible();
  expect(await main(shelf)).toBe(updateHost.manifest.a.main);
  updateHost.deployB();
  await shelf.getByRole('button', { name: '设置与数据管理' }).click();
  await shelf.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect.poll(() => waiting(shelf)).toBe('installed');
  await shelf.getByRole('button', { name: '返回书架', exact: true }).click();
  // Reopening the reader schedules a real 500ms progress write. Finish it
  // before taking the baseline; the update itself must change no records.
  await page.clock.runFor(1000);
  await expect
    .poll(() => progressTime(page))
    .toBeGreaterThan(priorProgressTime);
  const before = await updateData(shelf);
  await updated(shelf, updateHost);
  const after = await updateData(shelf);
  expect(after).toEqual(before);
  expect(await documentId(page)).toBe(oldDocument);
  expect(await main(page)).toBe(updateHost.manifest.a.main);
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await expect(
    page.getByRole('button', { name: '点击更新', exact: true }),
  ).toHaveCount(0);
  await page.bringToFront();
  await nextPage(page, 4);
  expect(await documentId(page)).toBe(oldDocument);
  await evidence(info, updateHost, 'other-tab-activation', before, after, {
    oldReaderDocumentPreserved: true,
    otherTabRenderedNewVersion: true,
    readingContinuedAfterControllerChange: true,
  });
});
