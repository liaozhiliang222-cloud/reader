import { test, expect } from './fixtures';
import { selectVisibleText } from './helpers';
import { readFile, writeFile } from 'node:fs/promises';
import { marked } from 'marked';

test.use({ locale: 'en-US' });
const body =
  'Chapter 1 The quiet page\n\n' +
  'Dr. Green reads a local book. The price is 3.14 dollars. A quiet page makes room for thought. '.repeat(
    100,
  );

async function openShelf(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip guide', exact: true }).click();
  await expect(page.locator('.wordmark')).toBeVisible();
  await expect(page.locator('.wordmark')).toHaveText('LumiRead');
}
async function menu(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', {
    name: 'Reading menu',
    exact: true,
  });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
}
async function noOverflow(page: import('@playwright/test').Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('English startup, manual language switch and persistence keep book data', async ({
  page,
  context,
  browserName,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openShelf(page);
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/i18n-library.png' });
  await page.goto('/#/paste');
  await page.getByLabel('Title (optional)').fill('原创 Original book');
  await page.getByLabel('Text', { exact: true }).fill(body);
  await page
    .getByRole('button', { name: 'Start reading', exact: true })
    .click();
  await expect(page.locator('.reader-footer')).toBeVisible();
  await expect(
    page.locator('.reader-content:not([aria-hidden="true"])'),
  ).toHaveAttribute('lang', 'en');
  await menu(page);
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove bookmark', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Back to library', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Settings and data', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'App language', exact: true })
    .selectOption('zh-Hans');
  await expect(
    page.getByRole('heading', { name: '设置', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: '界面语言', exact: true }),
  ).toHaveValue('zh-Hans');
  await page
    .getByRole('combobox', { name: '界面语言', exact: true })
    .selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/i18n-settings.png' });
  if (browserName === 'chromium') {
    await expect(
      page.getByText('Resources are ready. You can open the app offline.', {
        exact: true,
      }),
    ).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await page
      .getByRole('combobox', { name: 'App language', exact: true })
      .selectOption('zh-Hans');
    await page
      .getByRole('combobox', { name: '界面语言', exact: true })
      .selectOption('en');
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
  }
  await page
    .getByRole('button', { name: 'Back to library', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /原创 Original book/ }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: /Continue reading/ }).click();
  await expect(page.locator('.reader-footer')).toBeVisible();
  await menu(page);
  await expect(
    page.getByRole('button', { name: 'Remove bookmark', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/i18n-reader.png' });
});

test('English note export keeps user text, tags, original links and separate template names', async ({
  page,
}) => {
  await openShelf(page);
  await page.goto('/#/paste');
  await page.getByLabel('Title (optional)').fill('My original book');
  await page.getByLabel('Text', { exact: true }).fill(body);
  await page
    .getByRole('button', { name: 'Start reading', exact: true })
    .click();
  await expect(page.locator('.reader-footer')).toBeVisible();
  const selected = await selectVisibleText(page);
  await page
    .getByLabel('Text selection actions')
    .getByRole('button', { name: 'Notes', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit note', exact: true });
  await editor
    .getByLabel('Write your thoughts')
    .fill('我的想法 stays original');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await menu(page);
  await page
    .getByRole('button', { name: 'Back to library', exact: true })
    .click();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit thought', exact: true }).click();
  await page.getByLabel('Tags (comma-separated)').fill('quiet, 思考');
  await page.getByRole('button', { name: 'Save thought', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText('quiet · 思考');
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export this note', exact: true })
    .click();
  const file = await download;
  const markdown = await readFile((await file.path())!, 'utf8');
  expect(markdown).toContain('# LumiRead Notes');
  expect(marked.parse(markdown)).toContain(selected);
  expect(markdown).toContain('我的想法 stays original');
  expect(markdown).toContain('Tags: quiet, 思考');
  expect(markdown).toContain('jingye://note/');
  const quotes = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export Markdown', exact: true })
    .click();
  expect((await quotes).suggestedFilename()).toBe('LumiRead_Quotes.md');
  const review = page.waitForEvent('download');
  await page
    .getByRole('button', {
      name: 'Export reading review template',
      exact: true,
    })
    .click();
  expect((await review).suggestedFilename()).toBe('LumiRead_Reading_Review.md');
  // Exercise the real canvas and web download fallback. Native share/save stays
  // in the Mac/iPhone acceptance matrix.
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    }),
  );
  const image = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Quote image', exact: true }).click();
  const png = await image;
  expect(png.suggestedFilename()).toBe('LumiRead_Quote_1.png');
  const bytes = await readFile((await png.path())!);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(
    `artifacts/i18n-quote-${test.info().project.name}.png`,
    bytes,
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByText('Filter and sort', { exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/i18n-notes.png' });
});

test('Parsing worker reports errors in English without modifying imported text', async ({
  page,
}) => {
  await openShelf(page);
  await page
    .getByRole('button', { name: 'Import your first book', exact: true })
    .click();
  await page.getByLabel('Choose book files').setInputFiles({
    name: 'unsupported.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from([255, 254, 0, 0, 65]),
  });
  await expect(page.getByRole('alert')).toContainText(
    'UTF-32 is not supported',
  );
  await expect(page.getByRole('dialog')).toContainText(
    'Import complete: 0 imported, 0 already in library, 1 failed',
  );
});

test('English iOS purchase UI uses native language and the same product identity', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let loaded = false,
      pending = false,
      owned = false;
    const calls: { method: string; options: object }[] = [];
    Reflect.set(window, '__languageCalls', calls);
    Reflect.set(window, 'CapacitorCustomPlatform', { name: 'ios' });
    Reflect.set(window, 'Capacitor', {
      PluginHeaders: ['JyReader', 'JySpeech', 'JyPro', 'App'].map((name) => ({
        name,
        methods: [
          ...[
            'setLanguage',
            'request',
            'speech',
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
        calls.push({ method, options });
        if (plugin === 'JyPro') {
          if (options.action === 'product') loaded = true;
          if (options.action === 'purchase') pending = true;
          if (options.action === 'restore') {
            owned = true;
            pending = false;
          }
          return {
            protocolVersion: 1,
            productId: 'dev.jingye.reader.pro',
            isPro: owned,
            status: owned ? 'owned' : pending ? 'pending' : 'free',
            price: loaded ? '$2.99' : undefined,
            message: '',
          };
        }
        if (method === 'consumeLaunchFile') return { items: [] };
        return {};
      },
      nativeCallback: () => 'listener',
    });
  });
  await openShelf(page);
  await page
    .getByRole('button', { name: 'Settings and data', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Purchase and restore', exact: true })
    .click();
  const panel = page.getByRole('dialog', {
    name: 'LumiRead Pro',
    exact: true,
  });
  await expect(panel).toContainText('Pro not unlocked');
  await expect(panel).not.toContainText('acceptance tests');
  await panel.getByRole('button', { name: 'View price', exact: true }).click();
  await panel
    .getByRole('button', { name: 'One-time purchase · $2.99', exact: true })
    .click();
  await expect(panel).toContainText('Waiting for purchase approval');
  await panel
    .getByRole('button', { name: 'Restore purchases', exact: true })
    .click();
  await expect(panel).toContainText('Pro unlocked');
  expect(
    await page.evaluate(() => Reflect.get(window, '__languageCalls')),
  ).toContainEqual({ method: 'setLanguage', options: { language: 'en' } });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/i18n-pro.png' });
});

test.describe('unsupported system language', () => {
  test.use({ locale: 'fr-FR' });
  test('Falls back to English and follows the system again after a manual choice', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Skip guide', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'App language', exact: true })
      .selectOption('zh-Hans');
    await expect(
      page.getByRole('button', { name: '跳过引导', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: '界面语言', exact: true })
      .selectOption('system');
    await expect(
      page.getByRole('button', { name: 'Skip guide', exact: true }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await noOverflow(page);
    await page.screenshot({ path: 'artifacts/i18n-onboarding.png' });
  });
});
