import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { openShelf, menu, nextPage, paragraphs, setFontSize } from './helpers';
import { compatibilityEpub } from '../src/parsers/epub/compatFixtures';
import { imageGeometry } from './layoutAssertions';

test('嵌套图片段在分页、字号与横竖屏变化后不溢出正文列', async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(
    await compatibilityEpub(
      '<p id="target"><a><span><img src="original.png" alt="原创图一"/></span></a></p>' +
        `<p>${paragraphs[0]}</p>` +
        '<p><span><a><img src="original.png" alt="原创图二"/></a></span></p>' +
        paragraphs
          .slice(1, 8)
          .map((text) => `<p>${text}</p>`)
          .join(''),
      '原创图文分页回归',
    ),
  );
  const opf = zip.file('OPS/book.opf')!;
  zip.file(
    'OPS/book.opf',
    (await opf.async('string')).replace(
      '</manifest>',
      '<item id="image" href="original.png" media-type="image/png"/></manifest>',
    ),
  );
  zip.file('OPS/original.png', await readFile('public/icons/icon-512.png'));
  await openShelf(page);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: '原创图文.epub',
    mimeType: 'application/epub+zip',
    buffer: await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    }),
  });
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  const root = page.locator('.reader-content:not([aria-hidden="true"])');
  await expect(root.locator('img')).toHaveCount(2);
  for (let number = 1; number <= 3; number++) {
    if (number > 1) await nextPage(page, number);
    await imageGeometry(page);
  }
  await menu(page);
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await setFontSize(page, 28);
  await expect(root).toHaveCSS('font-size', '28px');
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await imageGeometry(page);
  // Android enters fullscreen on book open; restore the real window before
  // Playwright changes viewport bounds to simulate rotation.
  if (await page.evaluate(() => !!document.fullscreenElement)) {
    await menu(page);
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  }
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.height,
    height: viewport.width,
  });
  await expect(page.locator('.reader-viewport')).toHaveCSS(
    'height',
    `${viewport.width}px`,
  );
  const line = 28 * 1.8;
  const height = Math.floor((viewport.width - 112) / line) * line;
  await expect(root).toHaveCSS('height', `${height}px`);
  await imageGeometry(page);
  await page.screenshot({
    path: info.outputPath('wrapped-image-landscape.png'),
  });
});
