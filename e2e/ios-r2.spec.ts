import { test, expect } from './fixtures';
import { openShelf, selectVisibleText, menu, openMore } from './helpers';
import JSZip from 'jszip';

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

test('iOS 购买门控：商品显式加载、等待批准、恢复与撤销（系统服务替身）', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let owned = false,
      pending = false,
      product = false;
    const requests: string[] = [],
      listeners = new Map<string, (event: object) => void>();
    const state = () => ({
      protocolVersion: 1,
      productId: 'dev.jingye.reader.pro',
      isPro: owned,
      status: owned ? 'owned' : pending ? 'pending' : 'free',
      price: product ? '¥1.00' : undefined,
      message: '',
    });
    Reflect.set(window, 'CapacitorCustomPlatform', { name: 'ios' });
    Reflect.set(window, 'Capacitor', {
      PluginHeaders: ['JyReader', 'JySpeech', 'JyPro', 'App'].map((name) => ({
        name,
        methods: [
          ...[
            'speech',
            'request',
            'consumeLaunchFile',
            'setImmersive',
            'keepAwake',
            'statusBar',
            'getLaunchUrl',
            'removeListener',
          ].map((name) => ({ name, rtype: 'promise' })),
          { name: 'addListener', rtype: 'callback' },
        ],
      })),
      nativePromise: async (
        plugin: string,
        method: string,
        options: { action?: string },
      ) => {
        if (plugin === 'JyPro' && method === 'request') {
          requests.push(options.action ?? 'state');
          if (options.action === 'product') product = true;
          if (options.action === 'purchase') pending = true;
          if (options.action === 'restore') {
            owned = true;
            pending = false;
          }
          return state();
        }
        if (method === 'speech') {
          if (options.action === 'state')
            return { snapshot: null, active: false };
          if (options.action === 'voices')
            return {
              engine: 'ios',
              engines: [{ id: 'ios', label: '系统语音替身' }],
              voices: [{ id: 'zh', language: 'zh-CN' }],
            };
        }
        if (method === 'consumeLaunchFile') return { items: [] };
        return {};
      },
      nativeCallback: (
        _plugin: string,
        _method: string,
        options: { eventName: string },
        callback: (event: object) => void,
      ) => {
        const id = `${options.eventName}:${listeners.size}`;
        listeners.set(id, callback);
        return id;
      },
    });
    Reflect.set(window, '__iosProDouble', {
      inspect: () => requests,
      revoke: () => {
        owned = false;
        for (const [event, listener] of listeners)
          if (event.startsWith('proChanged:')) listener({});
      },
    });
  });
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '购买与恢复购买' }).click();
  const panel = page.getByRole('dialog', { name: '微光阅读 Pro' });
  await expect(panel).toContainText('尚未解锁 Pro');
  const requests = await page.evaluate(() =>
    (
      Reflect.get(window, '__iosProDouble') as { inspect(): string[] }
    ).inspect(),
  );
  expect(requests).not.toContain('product');
  await panel.getByRole('button', { name: '查看购买价格' }).click();
  await panel.getByRole('button', { name: '一次购买 · ¥1.00' }).click();
  await expect(panel).toContainText('等待购买批准');
  await panel.getByRole('button', { name: '恢复购买' }).click();
  await expect(panel).toContainText('Pro 已解锁');
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  // Use paste so this test does not pretend to validate a physical Files picker.
  await page.goto('/#/paste');
  await page
    .getByLabel('正文', { exact: true })
    .fill('这是原创听书测试。'.repeat(50));
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await menu(page);
  await openMore(page);
  await page.getByRole('button', { name: '听书', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '从本页听', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    (Reflect.get(window, '__iosProDouble') as { revoke(): void }).revoke(),
  );
  await expect(page.getByRole('dialog', { name: '微光阅读 Pro' })).toContainText(
    '尚未解锁 Pro',
  );
});
