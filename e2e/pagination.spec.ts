import { test, expect } from './fixtures';
import { openShelf, importBook, nextPage } from './helpers';

const baseline = process.env.JINGYE_PIXEL_BASELINE;
if (baseline && baseline !== 'windows-2025')
  throw new Error(`未审查的分页像素基线环境：${baseline}`);

test('固定文本前三页像素回归', async ({ page }) => {
  await openShelf(page);
  await importBook(page, 'epub');
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  for (let number = 1; number <= 3; number++) {
    if (number > 1) await nextPage(page, number);
    await expect(page.locator('.reader-viewport')).toHaveScreenshot(
      baseline ? [baseline, `page-${number}.png`] : `page-${number}.png`,
      { animations: 'disabled' },
    );
  }
});
