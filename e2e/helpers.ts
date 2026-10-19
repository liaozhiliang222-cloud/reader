import { expect, type Page } from '@playwright/test';
import { compatibilityEpub } from '../src/parsers/epub/compatFixtures';

export const paragraphs = Array.from(
  { length: 90 },
  (_, i) =>
    `第${i + 1}段，窗外的风轻轻掠过树梢，书页在灯光下铺开。` +
    '这是一篇专为微光阅读自动验收编写的文字，用来检查翻页后的位置、选区与备份恢复。'.repeat(
      3,
    ),
);
export async function openShelf(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '跳过引导' }).click();
  await expect(
    page.getByRole('button', { name: '导入第一本书' }),
  ).toBeVisible();
}
export async function importBook(page: Page, type: 'txt' | 'epub') {
  const title = `自动验收-${type}`;
  const buffer =
    type === 'txt'
      ? Buffer.from('第一章 安静的书页\n\n' + paragraphs.join('\n\n'))
      : Buffer.from(
          await compatibilityEpub(
            '<h1 id="target">安静的书页</h1>' +
              paragraphs.map((p) => `<p>${p}</p>`).join(''),
            title,
          ),
        );
  await page.getByRole('button', { name: /导入第一本书|＋ 导入书籍/ }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: `${title}.${type}`,
    mimeType: type === 'txt' ? 'text/plain' : 'application/epub+zip',
    buffer,
  });
  await expect(page.locator('.reader-footer')).toHaveText(/1 \/ \d+ ·/);
  return title;
}
export async function menu(page: Page) {
  const toggle = page.getByRole('button', { name: '阅读菜单', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
}
export async function nextPage(page: Page, number: number) {
  await menu(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.reader-footer')).toHaveText(
    new RegExp(`^${number} /`),
  );
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
}
export async function backToShelf(page: Page) {
  await menu(page);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
}
export async function selectVisibleText(page: Page) {
  return page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root) => {
      const viewport = document
        .querySelector('.reader-viewport')!
        .getBoundingClientRect();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.parentElement?.closest('[data-p]')) continue;
        for (
          let offset = 0;
          offset + 8 <= (node.textContent?.length ?? 0);
          offset += 8
        ) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 8);
          const rect = range.getBoundingClientRect();
          if (
            rect.top > viewport.top + 30 &&
            rect.bottom < viewport.bottom - 30 &&
            rect.left >= viewport.left &&
            rect.right <= viewport.right
          ) {
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            return range.toString();
          }
        }
      }
      throw new Error('当前页没有可选文字');
    });
}
/** 排版面板中的分段/色块选项。 */
export function option(page: Page, group: string, name: string) {
  return page
    .getByRole('group', { name: group, exact: true })
    .getByRole('radio', { name, exact: true });
}
export async function choose(page: Page, group: string, name: string) {
  await option(page, group, name).check();
}
export async function setFontSize(page: Page, size: number) {
  const current = page.getByLabel('当前字号', { exact: true });
  for (let step = 0; step < 20; step++) {
    const value = Number(await current.innerText());
    if (value === size) return;
    await page
      .getByRole('button', {
        name: value < size ? '增大字号' : '减小字号',
        exact: true,
      })
      .click();
    await expect(current).not.toHaveText(String(value));
  }
  throw new Error(`无法把字号调到 ${size}`);
}
export async function openMore(page: Page) {
  const more = page.getByRole('button', { name: '更多', exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}
