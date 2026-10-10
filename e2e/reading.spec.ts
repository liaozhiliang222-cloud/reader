import { test, expect } from './fixtures';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import {
  openShelf,
  importBook,
  nextPage,
  menu,
  backToShelf,
  selectVisibleText,
} from './helpers';

for (const type of ['txt', 'epub'] as const) {
  test(`${type} 导入、翻页、刷新、划线、完整备份清空恢复`, async ({
    page,
  }, info) => {
    const errors: string[] = [],
      external: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== 'http://127.0.0.1:4180'
      )
        external.push(request.url());
    });
    await openShelf(page);
    const title = await importBook(page, type);
    await nextPage(page, 2);
    await nextPage(page, 3);
    const progress = await page.locator('.reader-footer').innerText();
    // Leaving the reader flushes its debounced progress before reload.
    await backToShelf(page);
    await page.reload();
    await page.locator('.shelf-entry').filter({ hasText: title }).click();
    await expect(page.locator('.reader-footer')).toHaveText(progress);
    const selected = await selectVisibleText(page);
    await expect(page.getByLabel('文字选区操作')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '添加朱砂红划线' }),
    ).toBeInViewport();
    await page.getByRole('button', { name: '添加朱砂红划线' }).click();
    await expect(page.getByLabel('文字选区操作')).toHaveCount(0);
    await menu(page);
    await page.getByRole('button', { name: '添加书签', exact: true }).click();
    await expect(page.getByRole('button', { name: '移除书签' })).toBeVisible();
    await backToShelf(page);
    await page.getByRole('button', { name: '设置与数据管理' }).click();
    await page.getByRole('button', { name: '生成完整备份' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载备份' }).click();
    const download = await downloadPromise;
    const path = info.outputPath('roundtrip.zip');
    await download.saveAs(path);
    const archive = await JSZip.loadAsync(await readFile(path));
    const backup = JSON.parse(
      await archive.file('backup.json')!.async('string'),
    ) as {
      books: unknown[];
      highlights: { text: string }[];
      bookmarks: unknown[];
      files: unknown[];
    };
    expect(backup.books).toHaveLength(1);
    expect(backup.highlights.map((item) => item.text)).toEqual([selected]);
    expect(backup.bookmarks).toHaveLength(1);
    expect(backup.files).toHaveLength(1);
    await page
      .getByRole('button', { name: '清空所有数据', exact: true })
      .click();
    await page.getByLabel('请输入“清空”确认').fill('清空');
    await page.getByRole('button', { name: '确认清空', exact: true }).click();
    await expect(
      page.getByText('本地数据已清空。', { exact: true }),
    ).toBeVisible();
    await page
      .locator('input[type="file"][accept*=".zip"]')
      .setInputFiles(path);
    await page.getByRole('button', { name: '合并恢复', exact: true }).click();
    await expect(
      page.getByText('恢复完成。书架共 1 本。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '返回书架', exact: true }).click();
    await page.locator('.shelf-entry').filter({ hasText: title }).click();
    await expect(page.locator('.reader-footer')).toHaveText(progress);
    await menu(page);
    await expect(page.getByRole('button', { name: '移除书签' })).toBeVisible();
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.getByRole('tab', { name: /笔记/ }).click();
    await expect(page.getByText(selected, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}
