import { test, expect } from './fixtures';
import { openShelf, importBook, nextPage } from './helpers';

test('固定文本前三页像素回归', async ({ page }) => {
  await openShelf(page);
  await importBook(page, 'epub');
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  for (let number = 1; number <= 3; number++) {
    if (number > 1) await nextPage(page, number);
    await expect(page.locator('.reader-viewport')).toHaveScreenshot(
      `page-${number}.png`,
      { animations: 'disabled' },
    );
  }
});
