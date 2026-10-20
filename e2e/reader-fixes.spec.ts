import { test, expect } from './fixtures';
import {
  openShelf,
  importBook,
  menu,
  choose,
  selectVisibleText,
} from './helpers';

test('四主题纹理实际改变纸面像素，关闭还原且重开保持本书设置', async ({
  page,
}, info) => {
  await openShelf(page);
  const title = await importBook(page, 'txt');
  for (const theme of ['米白纸', '浅灰纸', '护眼绿', '墨黑夜读']) {
    await menu(page);
    await page.getByRole('button', { name: '排版与主题', exact: true }).click();
    await choose(page, '主题', theme);
    const texture = page.getByLabel('纸张纹理', { exact: true });
    await texture.uncheck();
    await page.getByRole('button', { name: '继续阅读', exact: true }).click();
    const footer = await page.locator('.reader-footer').innerText();
    // A blank corner measures the paper surface, independently of text antialiasing.
    const clip = { x: 4, y: 100, width: 16, height: 128 };
    const off = await page.screenshot({ clip });
    await menu(page);
    await page.getByRole('button', { name: '排版与主题', exact: true }).click();
    await texture.check();
    await page.getByRole('button', { name: '继续阅读', exact: true }).click();
    const on = await page.screenshot({ clip });
    expect(on.equals(off), `${theme} 应看得见纹理变化`).toBe(false);
    await expect(page.locator('.reader-footer')).toHaveText(footer);
    await page.screenshot({ path: info.outputPath(`${theme}-texture.png`) });
    await menu(page);
    await page.getByRole('button', { name: '排版与主题', exact: true }).click();
    await texture.uncheck();
    await page.getByRole('button', { name: '继续阅读', exact: true }).click();
    expect((await page.screenshot({ clip })).equals(off)).toBe(true);
  }
  await menu(page);
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await page.getByLabel('纸张纹理', { exact: true }).check();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.reload();
  await page.locator('.shelf-entry').filter({ hasText: title }).click();
  await menu(page);
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await expect(page.getByLabel('纸张纹理', { exact: true })).toBeChecked();
});

test('正文阻止默认菜单且保留选区、复制与笔记输入的系统菜单', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          Reflect.set(window, '__copiedText', text);
        },
      },
    });
  });
  await openShelf(page);
  await importBook(page, 'txt');
  const selected = await selectVisibleText(page);
  const content = page.locator('.reader-content:not([aria-hidden="true"])');
  expect(
    await content.evaluate((root) => {
      const text = root.querySelector('[data-p]')!;
      return text.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    }),
  ).toBe(false);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    selected,
  );
  await expect(page.getByLabel('文字选区操作')).toHaveCount(1);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '复制', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__copiedText')))
    .toBe(selected);
  await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const input = page.getByLabel('写下此刻的想法');
  expect(
    await input.evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      ),
    ),
  ).toBe(true);
  await input.fill('保留输入框粘贴与编辑操作');
  await page
    .getByRole('dialog', { name: '编辑笔记' })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '编辑笔记' })).toHaveCount(0);
});
