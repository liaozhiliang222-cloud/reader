import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { openShelf, importBook, nextPage, backToShelf, menu } from './helpers';
import { updateData } from './updateData';

test('线上 HTTPS：真实 Worker/IDB、进度书签重载；Chromium 断网重新启动', async ({
  page,
  context,
  browserName,
  baseURL,
}, info) => {
  if (!baseURL) throw new Error('Missing deployment URL');
  const origin = new URL(baseURL).origin;
  const external: string[] = [];
  const errors: string[] = [];
  const workers: string[] = [];
  context.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  await openShelf(page);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  const title = await importBook(page, 'txt');
  await nextPage(page, 2);
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  const progress = await page.locator('.reader-footer').innerText();
  await backToShelf(page);
  const saved = await updateData(page);
  expect(saved.books).toHaveLength(1);
  expect(saved.bookmarks).toHaveLength(1);
  expect(
    workers.some((url) => url.startsWith(`${origin}/assets/parse.worker-`)),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const sw = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      script: registration.active?.scriptURL,
      state: registration.active?.state,
    };
  });
  expect(sw.script).toBe(`${origin}/sw.js`);
  expect(sw.state).toBe('activated');
  await page.reload();
  await page.locator('.shelf-entry').filter({ hasText: title }).click();
  await expect(page.locator('.reader-footer')).toHaveText(progress);
  await menu(page);
  await expect(
    page.getByRole('button', { name: '移除书签', exact: true }),
  ).toBeVisible();
  await backToShelf(page);
  const reload = await updateData(page);
  expect(reload.books).toHaveLength(1);
  expect(reload.blobs).toEqual(saved.blobs);
  expect(reload.bookmarks).toEqual(saved.bookmarks);
  const offline = browserName === 'chromium';
  if (offline) {
    await context.setOffline(true);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
    await page.locator('.shelf-entry').filter({ hasText: title }).click();
    await expect(page.locator('.reader-footer')).toHaveText(progress);
    await nextPage(page, 3);
    await backToShelf(page);
    await expect(
      page.getByRole('button', { name: '设置与数据管理' }),
    ).toBeVisible();
    await context.setOffline(false);
  }
  await page.screenshot({ path: info.outputPath('https-shelf.png') });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await mkdir('artifacts/deployment-browser', { recursive: true });
  await writeFile(
    `artifacts/deployment-browser/${info.project.name}.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin,
        engine: info.project.name,
        secureContext: true,
        workerUrls: workers,
        serviceWorker: sw,
        realWorkerAndIdb: true,
        bookmarkAndOriginalHashPreserved: true,
        originalBlobs: saved.blobs,
        offlineRestartAndPageTurn: offline,
        offlineLimitation: offline
          ? null
          : 'Windows WebKit offline simulation is not accepted as iOS evidence',
        externalRequests: external,
        pageErrors: errors,
        physicalDeviceAcceptance: false,
      },
      null,
      2,
    ) + '\n',
  );
});
