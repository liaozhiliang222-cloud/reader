import { test, expect } from './fixtures';
import { openShelf, menu, backToShelf, nextPage } from './helpers';
import { imageGeometry } from './layoutAssertions';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseMarkdown } from '../src/parsers/markdown';

async function selectPhrase(page: Page, phrase: string) {
  await active(page).evaluate((root, phrase) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[data-md-visual],[data-md-source]'))
        continue;
      const index = node.textContent?.indexOf(phrase) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + phrase.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return;
    }
    throw new Error('Selection phrase missing: ' + phrase);
  }, phrase);
  await expect(page.getByLabel('文字选区操作')).toBeVisible();
}
const active = (page: Page) =>
  page.locator('.reader-content:not([aria-hidden="true"])');
async function showDiagram(page: Page) {
  const image = active(page).locator('[data-md-visual="diagram"] img');
  await expect(image).toBeVisible();
  const total = Number(
    (await page.locator('.reader-footer').innerText()).match(/\/ (\d+)/)![1],
  );
  for (let number = 1; number < total; number++) {
    const withinPage = await image.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const frame = document
        .querySelector('.reader-viewport')!
        .getBoundingClientRect();
      return rect.left >= frame.left && rect.right <= frame.right;
    });
    if (withinPage) break;
    await nextPage(page, number + 1);
  }
  expect(
    await image.evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(image).toBeInViewport({ ratio: 1 });
  await imageGeometry(page);
  // This chapter only has its heading and diagram: no empty border-only tail page.
  await expect(page.locator('.reader-footer')).toHaveText(
    new RegExp(`^${total} / ${total} ·`),
  );
}
async function importFile(
  page: Page,
  name: string,
  buffer: Buffer,
  duplicateTitle?: string,
) {
  await page.getByRole('button', { name: /导入第一本书|＋ 导入书籍/ }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name,
    mimeType: name.endsWith('.zip') ? 'application/zip' : 'text/markdown',
    buffer,
  });
  if (duplicateTitle)
    await page
      .getByRole('button', { name: `阅读《${duplicateTitle}》`, exact: true })
      .click();
  await expect(page.locator('.reader-footer')).toHaveText(/1 \/ \d+ ·/);
}
async function jump(page: Page, title: string) {
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page
    .locator('[data-toc-index] button')
    .filter({ hasText: title })
    .click();
}
function noExternalRequests(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error('Missing Markdown test origin');
  const origin = new URL(baseURL).origin;
  const requests: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      requests.push(request.url());
  });
  return requests;
}
const enhanced =
  '# MD 第二版\n\n前文 $x^2 + y^2 = z^2$ 后面的可选文字😀。\n\n$$\n\\frac{1}{2} + \\sqrt{4} = \\frac{5}{2}\n$$\n\n[[图表|查看图表]] 和 引用[^说明]\n\n```ts\n  const value = 42;\n  console.log("你好");\n```\n\n## 图表\n\n```mermaid\ngraph TD\n A[开始] --> B{判断}\n B --> C[完成]\n```\n\n## 时序图\n\n```mermaid\nsequenceDiagram\n Alice->>Bob: 你好\n Bob-->>Alice: 收到\n```\n\n[^说明]: **脚注内容**，引用仍然保留。';

test('第二版公式/代码高亮/双链/脚注与两类Mermaid图表在双引擎可读', async ({
  page,
  baseURL,
}, info) => {
  const requests = noExternalRequests(page, baseURL);
  await openShelf(page);
  await importFile(page, 'enhanced.md', Buffer.from(enhanced));
  await expect(active(page).locator('math')).toHaveCount(2);
  await expect(active(page).locator('.hljs-keyword').first()).toHaveText(
    'const',
  );
  await expect(
    active(page).locator('[data-md-visual] [href],[data-md-visual] script'),
  ).toHaveCount(0);
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('markdown-v2-math-code.png') });
  await selectPhrase(page, '后面的可选文字😀');
  await page.getByRole('button', { name: '添加琥珀黄划线' }).click();
  await page.getByRole('button', { name: '查看图表', exact: true }).click();
  await expect(page.locator('.reader-header')).toHaveText('图表');
  await showDiagram(page);
  await page.screenshot({ path: info.outputPath('markdown-v2-diagram.png') });
  await jump(page, '时序图');
  await showDiagram(page);
  await page.screenshot({ path: info.outputPath('markdown-v2-sequence.png') });
  await jump(page, '注释 1');
  await expect(active(page)).toContainText('脚注内容');
  await jump(page, 'MD 第二版');
  await page.getByRole('button', { name: '[1]', exact: true }).click();
  await expect(active(page)).toContainText('脚注内容');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const id = decodeURIComponent(location.hash.split('/').at(-1)!);
        return new Promise<number | undefined>((resolve, reject) => {
          const opened = indexedDB.open('jingye');
          opened.onerror = () => reject(opened.error);
          opened.onsuccess = () => {
            const db = opened.result;
            const read = db
              .transaction('progress')
              .objectStore('progress')
              .get(id);
            read.onsuccess = () => {
              resolve(read.result?.locator.chapterIndex);
              db.close();
            };
            read.onerror = () => {
              reject(read.error);
              db.close();
            };
          };
        });
      }),
    )
    .toBe(3);
  await page.reload();
  await expect(active(page)).toContainText('脚注内容');
  expect(requests).toEqual([]);
});

test('本地图文包及完整备份往返保留图片/源码/进度，远程和恶意图表不请求', async ({
  page,
  baseURL,
}, info) => {
  const requests = noExternalRequests(page, baseURL);
  const zip = new JSZip();
  zip.file(
    '文章.md',
    '# 图文文章\n\n![本地示意](assets/chart.svg)\n\n图片后的正文😀\n\n![远程](https://example.org/never.svg)\n\n```mermaid\ngraph TD\nclick A "https://example.org/never"\n```',
  );
  zip.file(
    'assets/chart.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#d9e5dc"/><text x="20" y="65" fill="#22382a">本地图片</text><script>window.ZIP_EXECUTED=true</script></svg>',
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await openShelf(page);
  await importFile(page, 'article.md.zip', bytes);
  await expect(active(page).locator('img[alt="本地示意"]')).toBeVisible();
  expect(
    await active(page)
      .locator('img[alt="本地示意"]')
      .evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBe(240);
  await expect(active(page).locator('[data-md-visual="diagram"]')).toHaveCount(
    0,
  );
  await selectPhrase(page, '图片后的正文😀');
  await page.getByRole('button', { name: '添加琥珀黄划线' }).click();
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('markdown-v2-image.png') });
  await backToShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '生成完整备份' }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份' }).click();
  const backup = await exported;
  const backupPath = info.outputPath('markdown-v2-backup.zip');
  await backup.saveAs(backupPath);
  const archived = await JSZip.loadAsync(await readFile(backupPath));
  const meta = JSON.parse(
    await archived.file('backup.json')!.async('string'),
  ) as { books: { markdownVersion: number }[]; files: { path: string }[] };
  expect(meta.books[0]!.markdownVersion).toBe(2);
  expect(await archived.file(meta.files[0]!.path)!.async('nodebuffer')).toEqual(
    bytes,
  );
  await page.getByRole('button', { name: '清空所有数据', exact: true }).click();
  await page.getByLabel('请输入“清空”确认').fill('清空');
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(
    page.getByText('本地数据已清空。', { exact: true }),
  ).toBeVisible();
  await page
    .locator('input[type="file"][accept*=".zip"]')
    .setInputFiles(backupPath);
  await page.getByRole('button', { name: '合并恢复' }).click();
  await expect(
    page.getByText('恢复完成。书架共 1 本。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.locator('.shelf-entry').filter({ hasText: '图文文章' }).click();
  await expect(active(page).locator('img[alt="本地示意"]')).toBeVisible();
  await expect(active(page).locator('mark')).toContainText('图片后的正文😀');
  expect(
    await page.evaluate(() => Reflect.get(window, 'ZIP_EXECUTED')),
  ).toBeUndefined();
  expect(requests).toEqual([]);
});

test('错误公式与禁止的图表配置回退源码，标题/注释缺失不会执行HTML', async ({
  page,
  baseURL,
}) => {
  const requests = noExternalRequests(page, baseURL);
  await openShelf(page);
  await importFile(
    page,
    'unsafe.md',
    Buffer.from(
      '# 安全增强\n\n$\\includegraphics{https://example.org/a}$ $\\unknowncmd$\n\n[[不存在]] [^missing]\n\n```mermaid\n%%{init: {"themeCSS":"body{display:none}"}}%%\ngraph TD; A-->B;\n```\n\n```mermaid\nthis is invalid\n```',
    ),
  );
  await expect(active(page).locator('math,img')).toHaveCount(0);
  await expect(active(page)).toContainText('unknowncmd');
  await expect(active(page)).toContainText('themeCSS');
  await page.getByRole('button', { name: '不存在', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未找到');
  expect(requests).toEqual([]);
});

test('首版备份与重复导入保持旧定位，第二版可从应用离线缓存重开', async ({
  page,
  context,
  browserName,
}) => {
  const original =
    '# 旧版 MD\n\n原文 $x^2$ [[旧版 MD]]。\n\n[^a]: 首版定义一\n[^a]: 首版定义二';
  const parsed = parseMarkdown(original, 1);
  const id = 'md:' + createHash('sha256').update(original).digest('hex');
  const path = `books/${encodeURIComponent(id)}.md`;
  const snapshot = {
    app: 'jingye',
    schemaVersion: 4,
    exportedAt: 2,
    kind: 'full',
    books: [
      {
        id,
        title: '旧版 MD',
        type: 'md',
        markdownVersion: 1,
        encoding: 'utf-8',
        charCount: parsed.charCount,
        chapterCount: parsed.chapters.length,
        size: Buffer.byteLength(original),
        importedAt: 1,
        lastReadAt: 1,
      },
    ],
    progress: [],
    bookmarks: [],
    highlights: [
      {
        id: 'old-note',
        bookId: id,
        chapterIndex: 0,
        start: { paragraphIndex: 1, charOffset: 3 },
        end: { paragraphIndex: 1, charOffset: 8 },
        text: '$x^2$',
        color: 'red',
        note: '首版笔记',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    settings: {},
    files: [{ bookId: id, path }],
  };
  const zip = new JSZip()
    .file('backup.json', JSON.stringify(snapshot))
    .file(path, original);
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
    name: 'legacy.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await page.getByRole('button', { name: '合并恢复', exact: true }).click();
  await expect(
    page.getByText('恢复完成。书架共 1 本。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.locator('.shelf-entry').filter({ hasText: '旧版 MD' }).click();
  await expect(active(page).locator('math,[data-md-link]')).toHaveCount(0);
  await expect(active(page)).toContainText('$x^2$ [[旧版 MD]]');
  await backToShelf(page);
  await importFile(page, 'legacy.md', Buffer.from(original), '旧版 MD');
  await expect(active(page).locator('math,[data-md-link]')).toHaveCount(0);
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: /笔记/ }).click();
  await expect(page.getByText('首版笔记', { exact: true })).toBeVisible();
  await page
    .locator('.reader-drawer')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await backToShelf(page);
  await importFile(page, 'offline.md', Buffer.from(enhanced));
  await expect(active(page).locator('math')).toHaveCount(2);
  await jump(page, '图表');
  await expect(
    active(page).locator('[data-md-visual="diagram"] img'),
  ).toBeVisible();
  await backToShelf(page);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  // The repository already documents Windows WebKit's offline simulation limit.
  if (browserName === 'chromium') await context.setOffline(true);
  await page.reload();
  await page.locator('.shelf-entry').filter({ hasText: 'MD 第二版' }).click();
  await expect(
    active(page).locator('[data-md-visual="diagram"] img'),
  ).toBeVisible();
  await jump(page, 'MD 第二版');
  await expect(active(page).locator('math')).toHaveCount(2);
  if (browserName === 'chromium')
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
});
