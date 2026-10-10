import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import {
  importBook,
  nextPage,
  selectVisibleText,
  menu,
  backToShelf,
} from './helpers';
import { updateData } from './updateData';

test('线上新旧部署：阅读保持旧文档，显式更新后七表/原文/笔记保留', async ({
  page,
  context,
  baseURL,
}, info) => {
  const run = process.env.JINGYE_LIVE_UPDATE_RUN;
  if (!run || !baseURL) throw new Error('Missing live update setup');
  const manifest = JSON.parse(
    await readFile('artifacts/deployment-update-run.json', 'utf8'),
  ) as {
    origin: string;
    preparedAt: string;
    oldMain: string;
    newMain: string;
    newMainSha256: string;
  };
  expect(new URL(baseURL).origin).toBe(manifest.origin);
  const errors: string[] = [],
    external: string[] = [],
    workers: string[] = [];
  context.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== manifest.origin
    )
      external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.clock.install();
  await page.addInitScript(() => {
    Reflect.set(window, 'liveUpdateDocument', crypto.randomUUID());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '跳过引导', exact: true }).click();
  const main = () =>
    page.locator('script[type="module"][src]').getAttribute('src');
  const documentId = () =>
    page.evaluate(() => Reflect.get(window, 'liveUpdateDocument') as string);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  expect(await main()).toBe(manifest.oldMain);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByLabel('启动时继续上次阅读').uncheck();
  await page.getByLabel('进入阅读时显示安静提示').uncheck();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await importBook(page, 'txt');
  await nextPage(page, 2);
  const quote = await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '编辑笔记', exact: true });
  await editor
    .getByLabel('写下此刻的想法')
    .fill('真实Cloudflare更新保留这条原创笔记。');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  const oldDocument = await documentId(),
    footer = await page.locator('.reader-footer').innerText();
  await writeFile(
    join(run, `${info.project.name}-ready.json`),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin: manifest.origin,
        main: await main(),
        original: (await updateData(page)).blobs,
        preparedAt: manifest.preparedAt,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `${info.project.name}: old HTTPS client prepared; awaiting deployment gate.`,
  );
  // The test remains on the OLD deployment until both ready files have been
  // checked, the real upload succeeds, and the stable HTTPS bytes match dist.
  await expect
    .poll(
      async () => {
        try {
          return (
            JSON.parse(await readFile(join(run, 'deployed.json'), 'utf8')) as {
              preparedAt: string;
            }
          ).preparedAt;
        } catch {
          return null;
        }
      },
      { timeout: 600_000, intervals: [1000, 3000, 5000] },
    )
    .toBe(manifest.preparedAt);
  await page.clock.fastForward(61 * 60 * 1000);
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration())?.waiting?.state ??
            null,
        ),
      { timeout: 60_000 },
    )
    .toBe('installed');
  expect(await documentId()).toBe(oldDocument);
  expect(await main()).toBe(manifest.oldMain);
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await expect(
    page.getByRole('button', { name: '点击更新', exact: true }),
  ).toHaveCount(0);
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
      note: '真实Cloudflare更新保留这条原创笔记。',
    }),
  ]);
  await page.getByRole('button', { name: '点击更新', exact: true }).click();
  await expect.poll(main, { timeout: 60_000 }).toBe(manifest.newMain);
  await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
  expect(await documentId()).not.toBe(oldDocument);
  const after = await updateData(page);
  expect(after).toEqual(before);
  const cacheHash = await page.evaluate(async (path) => {
    const response = await caches.match(new URL(path, location.origin));
    if (!response) throw new Error('Missing new cached main');
    return [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', await response.arrayBuffer()),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }, manifest.newMain);
  expect(cacheHash).toBe(manifest.newMainSha256);
  await page.locator('.shelf-entry').click();
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await menu(page);
  await expect(
    page.getByRole('button', { name: '移除书签', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(
    page.getByText('真实Cloudflare更新保留这条原创笔记。', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(workers.some((url) => new URL(url).origin === manifest.origin)).toBe(
    true,
  );
  const hash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  await writeFile(
    join(run, `${info.project.name}-passed.json`),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        engine: info.project.name,
        ...manifest,
        secureContext: true,
        oldReaderDocumentPreserved: true,
        explicitUpdate: true,
        sevenNativeTablesEqual: true,
        beforeSha256: hash(before),
        afterSha256: hash(after),
        originalBlobs: before.blobs,
        tableCounts: Object.fromEntries(
          Object.entries(before).map(([table, rows]) => [table, rows.length]),
        ),
        newMainCacheSha256: cacheHash,
        progressBookmarkAndNoteReopened: true,
        workers,
        errors,
        external,
        physicalDeviceAcceptance: false,
      },
      null,
      2,
    ) + '\n',
  );
});
