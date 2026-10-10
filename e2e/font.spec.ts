import { test, expect } from './fixtures';
import { openShelf, importBook, backToShelf, choose } from './helpers';
import asset from '../src/app/fontAsset.json' with { type: 'json' };

test('字体仅主动下载、离线缓存、重载与删除', async ({
  page,
  context,
  browserName,
}, info) => {
  const requests: string[] = [];
  context.on('request', (request) => {
    if (request.url().endsWith('.woff2')) requests.push(request.url());
  });
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await expect(
    page.getByRole('button', { name: /下载文楷字体/ }),
  ).toBeEnabled();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: /下载文楷字体/ }).click();
  await expect(
    page.getByText('文楷字体已保存在本机，可在排版设置中选择。'),
  ).toBeVisible();
  expect(requests).toEqual([`http://127.0.0.1:4180/${asset.file}`]);
  await choose(page, '字体', '文楷');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await importBook(page, 'txt');
  const loaded = () =>
    page.evaluate(() =>
      [...document.fonts].some(
        (face) => face.family === 'JingyeWenkai' && face.status === 'loaded',
      ),
    );
  await expect.poll(loaded).toBe(true);
  await expect(
    page.locator('.reader-content:not([aria-hidden="true"])'),
  ).toHaveCSS('font-family', /JingyeWenkai/);
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  await page
    .locator('.reader-viewport')
    .screenshot({ path: info.outputPath('font-reader.png') });
  await backToShelf(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Windows WebKit's offline switch is independently broken. Its online reload
  // still proves the persisted FontFace loads with no further font request.
  if (!(process.platform === 'win32' && browserName === 'webkit'))
    await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await expect(
    page.getByText('文楷字体已保存在本机，可在排版设置中选择。'),
  ).toBeVisible();
  await expect.poll(loaded).toBe(true);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '删除本机字体' }).click();
  await expect(
    page.getByRole('button', { name: /下载文楷字体/ }),
  ).toBeEnabled();
  await expect.poll(loaded).toBe(false);
  expect(requests).toHaveLength(1);
});

test.describe('字体下载错误注入', () => {
  // Request interception cannot reliably override requests around WebKit SW.
  // Only the fault-injection test blocks SW; normal download/offline tests keep it.
  test.use({ serviceWorkers: 'block' });
  test('字体校验失败不缓存，重试恢复', async ({ page }) => {
    await openShelf(page);
    await page.getByRole('button', { name: '设置与数据管理' }).click();
    await page.route('**/*.woff2', (route) =>
      route.fulfill({
        body: Buffer.alloc(asset.size),
        contentType: 'font/woff2',
      }),
    );
    await page.getByRole('button', { name: /下载文楷字体/ }).click();
    await expect(
      page.getByText('字体文件校验失败，请重新下载。'),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const names = (await caches.keys()).filter((name) =>
          name.startsWith('jingye-font-'),
        );
        let count = 0;
        for (const name of names)
          count += (await (await caches.open(name)).keys()).length;
        return count;
      }),
    ).toBe(0);
    await page.unroute('**/*.woff2');
    await page.getByRole('button', { name: /下载文楷字体/ }).click();
    await expect(
      page.getByText('文楷字体已保存在本机，可在排版设置中选择。'),
    ).toBeVisible();
  });
});
