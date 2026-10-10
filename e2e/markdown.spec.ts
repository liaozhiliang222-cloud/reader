import { test, expect } from './fixtures';
import {
  openShelf,
  menu,
  backToShelf,
  selectVisibleText,
  paragraphs,
  nextPage,
} from './helpers';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';

const article =
  '# MD 首版\n\n[外部资料](https://example.org/article) · [跳到附录](#附录)\n\n| 名称 | 数值 |\n|---|---:|\n| 项目甲 | **12** |\n| 项目乙 | 23 |\n\n- [x] 完成事项\n- [ ] 下一事项\n\n![示意图](https://example.org/never-load.png)\n\n## 代码\n\n```ts\n  const 名称 = "😀";\n  # 这不是目录标题\n  ' +
  'a'.repeat(100) +
  '\n```\n\n' +
  paragraphs.join('\n\n') +
  '\n\n## 附录\n\n末尾正文 **强调** 和 `代码`。';
const active = (page: Page) =>
  page.locator('.reader-content:not([aria-hidden="true"])');
async function importMd(
  page: Page,
  name = 'article.MARKDOWN',
  source = article,
) {
  await page.getByRole('button', { name: /导入第一本书|＋ 导入书籍/ }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name,
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await expect(page.locator('.reader-footer')).toHaveText(/1 \/ \d+ ·/);
}

test('MD文件、表格与代码分页、目录和链接安全', async ({ page }, info) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('request', (r) => {
    if (
      /^https?:/.test(r.url()) &&
      new URL(r.url()).origin !== 'http://127.0.0.1:4180'
    )
      external.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await openShelf(page);
  await importMd(page);
  await expect(
    active(page).locator('[data-md-kind="table-cell"]').first(),
  ).toContainText('名称：项目甲');
  await expect(active(page).locator('img,[href],[src]')).toHaveCount(0);
  await page.getByRole('button', { name: '外部资料', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '链接地址' })).toBeVisible();
  await expect(page.getByLabel('地址', { exact: true })).toHaveValue(
    'https://example.org/article',
  );
  await page
    .getByRole('dialog', { name: '链接地址' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('button', { name: '外部资料', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '链接地址' })).toBeVisible();
  await page
    .getByRole('dialog', { name: '链接地址' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('button', { name: '跳到附录', exact: true }).click();
  await expect(page.locator('.reader-header')).toHaveText('附录');
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.locator('[data-toc-index]')).toHaveCount(3);
  await page.locator('[data-toc-index="1"] button').click();
  await expect(page.locator('.reader-header')).toHaveText('代码');
  await expect(active(page).locator('[data-preformatted]')).toContainText(
    '  # 这不是目录标题',
  );
  const overflow = await active(page)
    .locator('[data-preformatted]')
    .evaluate((el) => {
      const width = el.getBoundingClientRect().width;
      return el.scrollWidth > width + 2;
    });
  expect(overflow).toBe(false);
  await page.screenshot({ path: info.outputPath('markdown-code.png') });
  await nextPage(page, 2);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('超长链接文字能跨页与分块，保留全部正文且可键盘查看地址', async ({
  page,
}) => {
  await openShelf(page);
  const label = '链接中的可读文字😀。'.repeat(6000);
  await importMd(
    page,
    'long-link.md',
    '# 长链接\n\n[' + label + '](https://example.org/long)\n\n结尾正文',
  );
  await expect(active(page)).toHaveAttribute('data-chunked', 'true');
  await expect
    .poll(async () => {
      const text = await page.locator('.reader-footer').innerText();
      return Number(/\d+ \/ (\d+)/.exec(text)?.[1] ?? 0);
    })
    .toBeGreaterThan(5);
  await nextPage(page, 2);
  const link = active(page).locator('[data-md-link]');
  await expect(link).toHaveAttribute('role', 'button');
  const paragraph = active(page).locator('[data-p="1"]');
  expect((await paragraph.textContent())!.length).toBeGreaterThan(1000);
  await nextPage(page, 3);
  const visible = await selectVisibleText(page);
  expect(label).toContain(visible);
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByLabel('文字选区操作')).toHaveCount(0);
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '链接地址' })).toBeVisible();
  await expect(page.getByLabel('地址', { exact: true })).toHaveValue(
    'https://example.org/long',
  );
});

test('MD完整备份清空恢复，划线笔记、书签、进度和原始字节保留', async ({
  page,
}, info) => {
  await openShelf(page);
  await importMd(page, 'article.md');
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.locator('[data-toc-index="1"] button').click();
  await nextPage(page, 2);
  const progress = await page.locator('.reader-footer').innerText();
  const selected = await selectVisibleText(page);
  await expect(page.getByLabel('文字选区操作')).toBeVisible();
  await page.getByRole('button', { name: '添加朱砂红划线' }).click();
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await backToShelf(page);
  await page.reload();
  await page.locator('.shelf-entry').filter({ hasText: 'MD 首版' }).click();
  await expect(page.locator('.reader-footer')).toHaveText(progress);
  await backToShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '生成完整备份' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份' }).click();
  const download = await downloading,
    path = info.outputPath('markdown.zip');
  await download.saveAs(path);
  const archive = await JSZip.loadAsync(await readFile(path));
  const meta = JSON.parse(
    await archive.file('backup.json')!.async('string'),
  ) as {
    schemaVersion: number;
    books: { id: string; type: string; markdownVersion: number }[];
    files: { path: string }[];
    highlights: { text: string }[];
  };
  expect(meta.schemaVersion).toBe(4);
  expect(meta.books[0]?.type).toBe('md');
  expect(meta.books[0]?.markdownVersion).toBe(2);
  expect(meta.highlights[0]?.text).toBe(selected);
  expect(await archive.file(meta.files[0]!.path)!.async('string')).toBe(
    article,
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
  await page.locator('.shelf-entry').filter({ hasText: 'MD 首版' }).click();
  await expect(page.locator('.reader-footer')).toHaveText(progress);
  await menu(page);
  await expect(page.getByRole('button', { name: '移除书签' })).toBeVisible();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: /笔记/ }).click();
  await expect(page.getByText(selected, { exact: true })).toBeVisible();
});

test('粘贴Markdown显式选择格式，标题代码不执行，移动端与夜间排版可读', async ({
  page,
}, info) => {
  await openShelf(page);
  await page.goto('/#/paste');
  await expect(
    page.getByRole('radio', { name: '纯文本', exact: true }),
  ).toBeChecked();
  await page.getByRole('radio', { name: 'Markdown', exact: true }).check();
  await page.getByLabel('标题（选填）').fill('AI 导出文章');
  await page
    .getByLabel('正文', { exact: true })
    .fill(
      '# AI 导出\n\n| 指标 | 结果 |\n|---|---|\n| 项目 | **很好** |\n\n> 引用内容\n\n<script>window.MD_EXECUTED = true</script>\n\n![插图](https://example.org/never.png)\n\n```mermaid\ngraph TD; A-->B;\n```',
    );
  await page.screenshot({ path: info.outputPath('markdown-format.png') });
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await expect(active(page).locator('strong')).toContainText([
    '指标：',
    '结果：',
    '很好',
  ]);
  expect(
    await page.evaluate(() => Reflect.get(window, 'MD_EXECUTED')),
  ).toBeUndefined();
  expect(new URL(page.url()).hash).toContain('paste-md%3A');
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('markdown-table.png') });
  await menu(page);
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await page.getByRole('radio', { name: '墨黑夜读', exact: true }).check();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.screenshot({ path: info.outputPath('markdown-night.png') });
});
