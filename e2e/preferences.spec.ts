import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { test as base, expect } from './fixtures';
import {
  openShelf,
  importBook,
  nextPage,
  menu,
  backToShelf,
  selectVisibleText,
  paragraphs,
  choose,
  openMore,
  option,
} from './helpers';
import { updateData } from './updateData';
import type {
  AppSettings,
  Book,
  Bookmark,
  Highlight,
  Progress,
  StoredChapter,
} from '../src/types';

interface Snapshot {
  books: Book[];
  chapters: StoredChapter[];
  progress: Progress[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
  settings: { id: string; value: AppSettings }[];
  blobs: { id: string; size: number; type: string; sha256: string }[];
}
async function snapshot(page: Page) {
  const value = await updateData(page);
  for (const key of [
    'books',
    'chapters',
    'progress',
    'bookmarks',
    'highlights',
    'settings',
    'blobs',
  ])
    expect(Array.isArray(value[key]), key).toBe(true);
  return value as unknown as Snapshot;
}
const currentSettings = (data: Snapshot) =>
  data.settings.find((row) => row.id === 'global')!.value;
const test = base.extend<{ privacyEvidence: void }>({
  privacyEvidence: [
    async ({ context, baseURL }, use, info) => {
      if (!baseURL) throw new Error('Missing test origin');
      const origin = new URL(baseURL).origin;
      const external: string[] = [],
        errors: string[] = [],
        workers: string[] = [];
      const watch = (page: Page) => {
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('worker', (worker) => workers.push(worker.url()));
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      context.on('request', (request) => {
        if (
          /^https?:/.test(request.url()) &&
          new URL(request.url()).origin !== origin
        )
          external.push(request.url());
      });
      await use();
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
      if (info.status === 'passed') {
        const runId = process.env.JINGYE_PREFERENCES_RUN;
        if (!runId) throw new Error('Missing preferences run ID');
        await writeFile(
          `artifacts/preferences-browser/${runId}/${info.project.name}-${info.title.split('：')[0]}.json`,
          JSON.stringify(
            {
              checkedAt: new Date().toISOString(),
              runId,
              engine: info.project.name,
              title: info.title,
              origin,
              workerUrls: workers,
              externalRequests: external,
              pageErrors: errors,
              automaticCspGuard: true,
              physicalDeviceAcceptance: false,
            },
            null,
            2,
          ) + '\n',
        );
      }
    },
    { auto: true },
  ],
});
async function encodingDialog(page: Page, encoding: string) {
  await menu(page);
  await openMore(page);
  await page.getByRole('button', { name: '切换编码', exact: true }).click();
  await page.getByLabel('原文件编码').selectOption(encoding);
  return page.getByRole('dialog', { name: '切换 TXT 编码' });
}
async function preview(page: Page, encoding: string) {
  const dialog = await encodingDialog(page, encoding);
  await dialog.getByRole('button', { name: '预览正文', exact: true }).click();
  await expect(dialog.getByLabel('解码预览')).toBeVisible();
  return dialog;
}
async function recode(page: Page, encoding: string) {
  const dialog = await preview(page, encoding);
  await dialog.getByRole('button', { name: '确认切换', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await snapshot(page)).books[0]?.encoding)
    .toBe(encoding);
  await expect(page.locator('.reader-footer')).toBeVisible();
}
async function addNote(page: Page, text: string) {
  const excerpt = await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '编辑笔记', exact: true });
  await editor.getByLabel('写下此刻的想法').fill(text);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  return excerpt;
}
async function showNotes(page: Page) {
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('tab', { name: /笔记/ }).click();
  return page.getByRole('tabpanel', { name: /笔记/ });
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await mkdir('test-books/preferences-evidence', { recursive: true });
  await page.screenshot({
    path: `test-books/preferences-evidence/${info.project.name}-${name}.png`,
  });
}

test('M2-06：误选编码再恢复UTF-8，原文件和待确认笔记保留、Markdown下载正确', async ({
  page,
}, info) => {
  await openShelf(page);
  await importBook(page, 'txt');
  await nextPage(page, 2);
  await nextPage(page, 3);
  const excerpt = await addNote(page, '编码回归原笔记');
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await backToShelf(page);
  const before = await snapshot(page);
  expect(before.progress[0]!.percent).toBeGreaterThan(0);
  await page.locator('.shelf-entry').click();
  await recode(page, 'utf-16le');
  const wrong = await snapshot(page);
  expect(wrong.books[0]!.id).toBe(before.books[0]!.id);
  expect(wrong.books[0]!.contentRevision).toBe(1);
  expect(wrong.chapters[0]!.paragraphs).not.toEqual(
    before.chapters[0]!.paragraphs,
  );
  expect(wrong.blobs).toEqual(before.blobs);
  expect(wrong.highlights[0]).toMatchObject({
    ...before.highlights[0],
    updatedAt: expect.any(Number),
    unanchored: true,
  });
  expect(wrong.bookmarks[0]).toEqual({
    ...before.bookmarks[0],
    unanchored: true,
  });
  await recode(page, 'utf-8');
  await backToShelf(page);
  const restored = await snapshot(page);
  expect(restored.books[0]!.contentRevision).toBe(2);
  expect(restored.chapters).toEqual(before.chapters);
  expect(restored.blobs).toEqual(before.blobs);
  expect(
    Math.abs(restored.progress[0]!.percent - before.progress[0]!.percent),
  ).toBeLessThan(2);
  expect(restored.highlights[0]).toMatchObject({
    id: before.highlights[0]!.id,
    text: excerpt,
    note: '编码回归原笔记',
    unanchored: true,
  });
  await page.reload();
  await page.locator('.shelf-entry').click();
  const notes = await showNotes(page);
  await expect(
    notes.getByRole('heading', { name: '位置待确认' }),
  ).toBeVisible();
  await expect(notes.locator('.note-jump')).toBeDisabled();
  await notes.getByRole('button', { name: '编辑笔记', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑笔记', exact: true });
  await editor.getByLabel('写下此刻的想法').fill('编码恢复后继续编辑');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await showNotes(page);
  const download = page.waitForEvent('download');
  await notes
    .getByRole('button', { name: '下载 Markdown', exact: true })
    .click();
  const path = info.outputPath('encoding-notes.md');
  await (await download).saveAs(path);
  const markdown = await readFile(path, 'utf8');
  expect(markdown).toContain(excerpt);
  expect(markdown).toContain('编码恢复后继续编辑');
  expect(markdown).toContain('位置待确认');
  await screenshot(page, info, 'encoding-unanchored');
  await page.getByRole('tab', { name: '书签', exact: true }).click();
  await expect(page.locator('.bookmark-jump')).toBeDisabled();
  await expect(page.locator('.bookmark-list')).toContainText('位置待确认');
});

test('M2-06并发：另一标签更新后旧预览和书签写入被拒绝，不覆盖新正文与进度', async ({
  page,
  context,
}) => {
  await openShelf(page);
  await importBook(page, 'txt');
  const stale = await context.newPage();
  try {
    await stale.goto(page.url());
    await expect(stale.locator('.reader-footer')).toBeVisible();
    const staleDialog = await preview(stale, 'utf-16le');
    await recode(page, 'utf-16le');
    await backToShelf(page);
    const updated = await snapshot(page);
    await staleDialog
      .getByRole('button', { name: '确认切换', exact: true })
      .click();
    await expect(staleDialog.getByRole('alert')).toHaveText(
      '书籍内容已在其他页面更新，请返回书架重新打开。',
    );
    await staleDialog
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await menu(stale);
    await stale.getByRole('button', { name: '添加书签', exact: true }).click();
    await expect(
      stale.getByText('书签未能保存，请检查本地存储。', { exact: true }),
    ).toBeVisible();
    const after = await snapshot(page);
    expect(after.books).toEqual(updated.books);
    expect(after.chapters).toEqual(updated.chapters);
    expect(after.progress).toEqual(updated.progress);
    expect(after.bookmarks).toEqual(updated.bookmarks);
    expect(after.blobs).toEqual(updated.blobs);
  } finally {
    await stale.close();
  }
});

test.describe('取消真实解析线程', () => {
  test.use({ serviceWorkers: 'block' });
  test('M2-06取消：延迟Worker模块加载时关闭预览会终止线程，原数据不变且可重试', async ({
    page,
    context,
  }) => {
    // Observe native termination while the real module request is held.
    // Forward every call; the constructor, parser and RPC remain native.
    await context.addInitScript(() => {
      const terminate = Worker.prototype.terminate;
      let count = 0;
      Object.defineProperty(window, 'nativeWorkerTerminations', {
        get: () => count,
      });
      Worker.prototype.terminate = function (this: Worker) {
        count++;
        return terminate.call(this);
      };
    });
    const terminationCount = () =>
      page.evaluate(() => {
        const value: unknown = Reflect.get(window, 'nativeWorkerTerminations');
        if (typeof value !== 'number')
          throw new Error('Missing native Worker observer');
        return value;
      });
    await openShelf(page);
    await importBook(page, 'txt');
    await backToShelf(page);
    const before = await snapshot(page);
    await page.locator('.shelf-entry').click();
    const countBefore = await terminationCount();
    let release: () => void = () => {};
    let markHeld: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    await context.route('**/assets/parse.worker-*.js', async (route) => {
      markHeld();
      await gate;
      try {
        await route.continue();
      } catch {
        /* The cancelled worker closes its pending request. */
      }
    });
    try {
      const dialog = await encodingDialog(page, 'utf-16le');
      await dialog
        .getByRole('button', { name: '预览正文', exact: true })
        .click();
      await held;
      await expect(
        dialog.getByRole('button', { name: '正在重新解析…' }),
      ).toBeDisabled();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(terminationCount).toBe(countBefore + 1);
    } finally {
      release();
      await context.unroute('**/assets/parse.worker-*.js');
    }
    const after = await snapshot(page);
    expect(after.books[0]!.encoding).toBe('utf-8');
    expect(after.books[0]!.contentRevision).toBe(
      before.books[0]!.contentRevision,
    );
    expect(after.chapters).toEqual(before.chapters);
    expect(after.blobs).toEqual(before.blobs);
    expect(after.bookmarks).toEqual(before.bookmarks);
    expect(after.highlights).toEqual(before.highlights);
    const retry = await preview(page, 'utf-8');
    await expect(retry.getByLabel('解码预览')).toContainText(paragraphs[0]!);
    await retry.getByRole('button', { name: '取消', exact: true }).click();
  });
});

test('M2-07：系统深浅媒体变化实时切换、保留全局和单本浅色主题与进度', async ({
  page,
}, info) => {
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await choose(page, '主题', '护眼绿');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'green');
  await page.getByLabel('跟随系统深色', { exact: true }).check();
  await expect(option(page, '浅色主题', '护眼绿')).toBeChecked();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  const title = await importBook(page, 'txt');
  await nextPage(page, 2);
  await menu(page);
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await choose(page, '浅色主题', '浅灰纸');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'eink');
  const returnButton = page.getByRole('button', {
    name: '返回书架',
    exact: true,
  });
  await expect(returnButton).toBeInViewport();
  expect(
    await returnButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const top = document
        .querySelector('.reader-menu-top')!
        .getBoundingClientRect();
      const bottom = document
        .querySelector('.reader-menu-bottom')!
        .getBoundingClientRect();
      return (
        bottom.top >= top.bottom &&
        document
          .elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          )
          ?.closest('button') === button
      );
    }),
  ).toBe(true);
  await screenshot(page, info, 'expanded-menu');
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  const progress = await page.locator('.reader-footer').innerText();
  const stored = await snapshot(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(20, 20, 20)',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#141414',
  );
  await expect(page.locator('.reader-footer')).toHaveText(progress);
  await expect(page.locator('.quiet-hint')).toHaveCount(0);
  await screenshot(page, info, 'system-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'eink');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#EDEDEB',
  );
  const afterMedia = await snapshot(page);
  expect(currentSettings(afterMedia).reading).toEqual(
    currentSettings(stored).reading,
  );
  expect(afterMedia.books[0]!.settingsOverride).toEqual(
    stored.books[0]!.settingsOverride,
  );
  await backToShelf(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'green');
  await page.locator('.shelf-entry').filter({ hasText: title }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'eink');
  await expect(page.locator('.reader-footer')).toHaveText(progress);
  await backToShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByLabel('跟随系统深色', { exact: true }).uncheck();
  await expect
    .poll(async () => currentSettings(await snapshot(page)).followSystemTheme)
    .toBe(false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'green');
  await page.reload();
  await expect(
    page.getByLabel('跟随系统深色', { exact: true }),
  ).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'green');
});

test('M2-08：30天边界、周期关闭重载、真实下载与旧快照不吞掉新笔记提醒', async ({
  page,
  context,
}, info) => {
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse('2026-10-02T02:00:00Z');
  const setDay = async (value: number) => {
    await page.clock.setFixedTime(start + value * day);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  };
  await page.clock.setFixedTime(start);
  await openShelf(page);
  await importBook(page, 'txt');
  await addNote(page, '初次笔记');
  await backToShelf(page);
  const first = await snapshot(page);
  expect(first.highlights[0]!.createdAt).toBe(start);
  const reminder = page.getByLabel('本地备份提醒');
  await expect(reminder).toHaveCount(0);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '生成轻量备份' }).click();
  await expect(page.getByRole('button', { name: '下载备份' })).toBeVisible();
  expect(currentSettings(await snapshot(page)).lastBackupAt).toBeUndefined();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await setDay(30);
  await expect(reminder).toHaveCount(0);
  await setDay(31);
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: '本周期不再提醒' }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload();
  await expect(reminder).toHaveCount(0);
  expect(currentSettings(await snapshot(page)).backupReminderDismissed).toEqual(
    { baseline: start, cycle: 1 },
  );
  await setDay(45);
  await expect(reminder).toHaveCount(0);
  await setDay(61);
  await expect(reminder).toBeVisible();
  await screenshot(page, info, 'backup-reminder');
  await reminder.getByRole('button', { name: '去备份' }).click();
  await expect(page.getByRole('region', { name: '备份与恢复' })).toBeFocused();
  await page.getByRole('button', { name: '生成轻量备份' }).click();
  await expect(page.getByRole('button', { name: '下载备份' })).toBeVisible();
  expect(currentSettings(await snapshot(page)).lastBackupAt).toBeUndefined();
  const newer = await context.newPage();
  try {
    await newer.clock.setFixedTime(start + 62 * day);
    await newer.goto(`/#/read/${first.books[0]!.id}`);
    await expect(newer.locator('.reader-footer')).toBeVisible();
    const notes = await showNotes(newer);
    await notes.getByRole('button', { name: '编辑笔记', exact: true }).click();
    const editor = newer.getByRole('dialog', { name: '编辑笔记', exact: true });
    await editor.getByLabel('写下此刻的想法').fill('旧快照之后新增的想法');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
  } finally {
    await newer.close();
  }
  await page.clock.setFixedTime(start + 62 * day);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  const path = info.outputPath('dated-backup.json');
  await (await download).saveAs(path);
  const backup: unknown = JSON.parse(await readFile(path, 'utf8'));
  expect(backup).toEqual(
    expect.objectContaining({
      exportedAt: start + 61 * day,
      schemaVersion: 5,
      highlights: [expect.objectContaining({ note: '初次笔记' })],
    }),
  );
  await expect
    .poll(async () => currentSettings(await snapshot(page)).lastBackupAt)
    .toBe(start + 61 * day);
  expect((await snapshot(page)).highlights[0]!.note).toBe(
    '旧快照之后新增的想法',
  );
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await setDay(91);
  await expect(reminder).toHaveCount(0);
  await setDay(92);
  await expect(reminder).toContainText('有新划线或笔记尚未备份');
});
