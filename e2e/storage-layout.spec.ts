import { test, expect } from './fixtures';
import { openShelf, importBook, nextPage, backToShelf, menu } from './helpers';

test('离线重载与离线 Worker 导入', async ({ page, context, browserName }) => {
  test.skip(
    process.platform === 'win32' && browserName === 'webkit',
    'Windows WebKit setOffline breaks even a minimal local SW response; see scripts/probe-webkit-offline.mjs. Physical iOS offline acceptance remains open.',
  );
  await openShelf(page);
  await importBook(page, 'txt');
  await nextPage(page, 2);
  await backToShelf(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
  await page.locator('.shelf-entry').click();
  await expect(page.locator('.reader-footer')).toHaveText(/^2 \//);
  await nextPage(page, 3);
  await backToShelf(page);
  await importBook(page, 'epub');
  await nextPage(page, 2);
});

test('书架和目录虚拟行真实几何与键盘末项导航', async ({ page }) => {
  await openShelf(page);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles(
    Array.from({ length: 24 }, (_, index) => ({
      name: `虚拟书${String(index + 1).padStart(2, '0')}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(
        Array.from(
          { length: 60 },
          (_, chapter) =>
            `第${chapter + 1}章 独立章节\n书籍${index + 1}的第${chapter + 1}章原创正文。\n`,
        ).join('\n'),
      ),
    })),
  );
  await expect(
    page.getByText('导入完成：24 本成功，0 本已在书架，0 本失败'),
  ).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: '关闭导入面板' }).click();
  const shelf = page.getByLabel('本地书架');
  await expect(shelf).toHaveCSS('height', `${24 * 140}px`);
  await shelf.locator('.shelf-entry').first().focus();
  await page.keyboard.press('End');
  const last = shelf.locator('[data-shelf-index="23"] .shelf-entry');
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await shelf.locator('li').count()).toBeLessThan(24);
  await last.click();
  await expect(page.locator('.reader-footer')).toHaveText(/1 \/ \d+ ·/);
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: '目录', exact: true }).click();
  const toc = page.locator('.toc-list');
  await toc.locator('button').first().focus();
  await page.keyboard.press('End');
  const finalChapter = toc.locator('[data-toc-index="59"] button');
  await expect(finalChapter).toBeFocused();
  await expect(finalChapter).toBeInViewport();
  expect(await toc.locator('li').count()).toBeLessThan(60);
  await finalChapter.click();
  await expect(page.locator('.reader-header')).toContainText('第60章');
});
