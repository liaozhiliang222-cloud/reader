import { test, expect } from './fixtures';
import { openShelf, selectVisibleText, menu, openMore } from './helpers';
import JSZip from 'jszip';
import { installSpeechBackend } from './speechBackend';

test('ZIP 选择导入与跨书笔记：原文回跳、标签、基础导出', async ({ page }) => {
  await openShelf(page);
  const zip = new JSZip();
  zip.file(
    '中文/甲.txt',
    '第一章 原创\n\n' + '窗外的风掠过树梢，让文字回到纸上。'.repeat(80),
  );
  zip.file('乙.txt', '第二章 原创\n\n这是另一本测试书。');
  zip.file('附件.bin', 'ignored');
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: '原创书包.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  const archive = page.getByRole('dialog', { name: '选择 ZIP 中的书籍' });
  await expect(
    archive.getByLabel('中文/甲.txt', { exact: false }),
  ).toBeChecked();
  await archive.getByLabel('乙.txt', { exact: false }).uncheck();
  await archive.getByRole('button', { name: '导入所选 1 本' }).click();
  await expect(page.locator('.reader-footer')).toBeVisible();
  const excerpt = await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '编辑笔记' });
  await editor.getByLabel('写下此刻的想法').fill('原创想法');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await menu(page);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText(excerpt);
  await page.getByRole('button', { name: '编辑想法', exact: true }).click();
  await page.getByLabel('标签（顿号分隔）').fill('安静、思考');
  await page.getByLabel('待回顾', { exact: true }).check();
  await page.getByRole('button', { name: '保存想法', exact: true }).click();
  await page.getByText('筛选与排序', { exact: true }).click();
  await page
    .getByRole('combobox', { name: '标签', exact: true })
    .selectOption('思考');
  await expect(page.locator('.notes-list')).toContainText('原创想法');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出此条', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('.md');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByText('筛选与排序', { exact: true }).click();
  expect(
    await page
      .locator('main')
      .evaluate((element) => element.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: 'artifacts/ios-r2-notes.png', fullPage: true });
  await page.getByRole('button', { name: '回到原文', exact: true }).click();
  await expect(page.locator('.reader-footer')).toBeVisible();
  expect(page.url()).toContain('?note=');
});

test('iOS 第一版无购买入口，笔记与听书直接可用（系统服务替身）', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installSpeechBackend(page, true, 'ios');
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await expect(
    page.getByRole('button', { name: /购买|恢复购买/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '关于微光阅读与隐私' }).click();
  await expect(
    page.getByText('第一版所有已提供的功能均免费开放。'),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/StoreKit|购买/);
  // Use paste so this test does not pretend to validate a physical Files picker.
  await page.goto('/#/paste');
  await page.getByLabel('标题（选填）').fill('免费版验收');
  await page
    .getByLabel('正文', { exact: true })
    .fill('窗外的风掠过树梢，让文字回到纸上。'.repeat(100));
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  const excerpt = await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const note = page.getByRole('dialog', { name: '编辑笔记' });
  await note.getByLabel('写下此刻的想法').fill('免费版想法');
  await note.getByRole('button', { name: '保存', exact: true }).click();
  await menu(page);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText(excerpt);
  await page.getByRole('button', { name: '编辑想法', exact: true }).click();
  await page.getByLabel('标签（顿号分隔）').fill('免费、回顾');
  await page.getByLabel('待回顾', { exact: true }).check();
  await page.getByRole('button', { name: '保存想法', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText('免费 · 回顾');
  for (const name of [
    '批量导出 Markdown',
    '导出读后整理模板',
    '随机回顾一条',
    '摘录图片',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
  }
  await page.getByRole('button', { name: '回到原文', exact: true }).click();
  await menu(page);
  await openMore(page);
  await page.getByRole('button', { name: '听书', exact: true }).click();
  await page.getByRole('button', { name: '从本页听', exact: true }).click();
  const bar = page.getByRole('complementary', { name: '听书控制' });
  await expect(bar).toContainText('正在听书');
  await bar.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(bar).toContainText('听书已暂停');
  await bar.getByRole('button', { name: '继续听书', exact: true }).click();
  await expect(bar).toContainText('正在听书');
  const calls = await page.evaluate(() =>
    (
      Reflect.get(window, '__speechBackendDouble') as {
        inspect(): { calls: { plugin: string; method: string }[] };
      }
    ).inspect(),
  );
  expect(calls.calls.some((call) => call.plugin === 'JyPro')).toBe(false);
  await expect(page.getByRole('dialog', { name: /Pro/ })).toHaveCount(0);
});

