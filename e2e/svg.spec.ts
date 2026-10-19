import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { openShelf, menu, backToShelf } from './helpers';
import { svgEpub } from '../src/parsers/epub/svgFixture';
import { imageGeometry } from './layoutAssertions';
import { updateData } from './updateData';

test('SVG 包装与安全矢量图真实导入、显示及完整备份恢复，不执行脚本或联网', async ({
  page,
  context,
  baseURL,
}, info) => {
  if (!baseURL) throw new Error('Missing application URL');
  const origin = new URL(baseURL).origin;
  const external: string[] = [];
  const errors: string[] = [];
  context.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const bytes = Buffer.from(
    await svgEpub(await readFile('public/icons/icon-512.png')),
  );
  await openShelf(page);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: 'SVG兼容.epub',
    mimeType: 'application/epub+zip',
    buffer: bytes,
  });
  await expect(page.locator('.reader-footer')).toBeVisible();
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  const root = page.locator('.reader-content:not([aria-hidden="true"])');
  await expect(root.locator('img')).toHaveCount(3);
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
  await imageGeometry(page);
  await page.screenshot({ path: info.outputPath('svg-cover.png') });
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page
    .getByRole('button', { name: '跳转到正文目标', exact: true })
    .click();
  await expect(root.locator('[data-p="1"]')).toBeInViewport();
  const progress = await page.locator('.reader-footer').innerText();
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await backToShelf(page);
  const before = await updateData(page);
  expect(before.books?.[0]).toEqual(
    expect.objectContaining({ parserVersion: 3 }),
  );
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '生成完整备份' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份' }).click();
  const path = info.outputPath('svg-roundtrip.zip');
  await (await downloading).saveAs(path);
  const zip = await JSZip.loadAsync(await readFile(path));
  const backup: unknown = JSON.parse(
    await zip.file('backup.json')!.async('string'),
  );
  expect(backup).toEqual(
    expect.objectContaining({
      schemaVersion: 5,
      books: [expect.objectContaining({ parserVersion: 3 })],
    }),
  );
  await page.getByRole('button', { name: '清空所有数据', exact: true }).click();
  await page.getByLabel('请输入“清空”确认').fill('清空');
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(
    page.getByText('本地数据已清空。', { exact: true }),
  ).toBeVisible();
  await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(path);
  await page.getByRole('button', { name: '合并恢复', exact: true }).click();
  await expect(
    page.getByText('恢复完成。书架共 1 本。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  const after = await updateData(page);
  expect(after.books).toEqual(before.books);
  expect(after.chapters).toEqual(before.chapters);
  expect(after.progress).toEqual(before.progress);
  expect(after.bookmarks).toEqual(before.bookmarks);
  // ZIP stores original file bytes, not the browser-provided File MIME type.
  // Restored originals are untyped and are parsed by the persisted book type;
  // derived raster/SVG MIME types and every Blob's SHA/size must stay identical.
  const restoredBlobs = before.blobs?.map((row) => {
    if (
      row &&
      typeof row === 'object' &&
      'id' in row &&
      typeof row.id === 'string' &&
      !row.id.includes(':image:')
    )
      return { ...row, type: '' };
    return row;
  });
  expect(after.blobs).toEqual(restoredBlobs);
  await page.locator('.shelf-entry').click();
  await expect(page.locator('.reader-footer')).toHaveText(progress);
  await expect(root.locator('img')).toHaveCount(3);
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
  await imageGeometry(page);
  await menu(page);
  await expect(
    page.getByRole('button', { name: '移除书签', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await page.screenshot({ path: info.outputPath('svg-restored.png') });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
