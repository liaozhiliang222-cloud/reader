import type { Locator, Page } from '@playwright/test';
import { test, expect } from './experienceFixtures';
import { openShelf } from './helpers';
import { updateData } from './updateData';

async function keyboardActivate(page: Page, target: Locator) {
  for (let i = 0; i < 80; i++) {
    if (
      await target.evaluate((element) => document.activeElement === element)
    ) {
      const rect = await target.boundingBox();
      if (!rect) throw new Error('Focused control has no geometry');
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('No test viewport');
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('Control cannot be reached by keyboard');
}

async function checkGuide(page: Page, title: string) {
  const heading = page.locator('#guide-heading');
  await expect(heading).toHaveText(title);
  await expect(heading).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const sizes = await page
    .locator('.onboarding button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
  for (const size of sizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
}

test('GUIDE-01：320px 三屏键盘往返、完成与重载保留显式文稿路由', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/#/paste');
  await checkGuide(page, '你的书只在这台设备上');
  await page.screenshot({ path: info.outputPath('guide-local-data.png') });
  const next = page.getByRole('button', { name: '下一步', exact: true });
  await keyboardActivate(page, next);
  await checkGuide(page, '添加到主屏幕');
  if (await page.evaluate(() => /iPhone|iPad|iPod/.test(navigator.userAgent))) {
    await expect(
      page
        .getByRole('list', { name: 'Safari 添加到主屏幕步骤' })
        .getByRole('listitem'),
    ).toHaveCount(3);
    await expect(page.locator('.install-steps svg')).toHaveCount(2);
  }
  await page.screenshot({
    path: info.outputPath('guide-install.png'),
    fullPage: true,
  });
  await keyboardActivate(
    page,
    page.getByRole('button', { name: '上一步', exact: true }),
  );
  await checkGuide(page, '你的书只在这台设备上');
  await keyboardActivate(page, next);
  await checkGuide(page, '添加到主屏幕');
  await keyboardActivate(page, next);
  await checkGuide(page, '读书时，打开勿扰模式');
  await keyboardActivate(
    page,
    page.getByRole('button', { name: '开始使用', exact: true }),
  );
  await expect(page.locator('.paste-page')).toBeVisible();
  const data = await updateData(page);
  expect(data.settings).toEqual([
    expect.objectContaining({
      id: 'global',
      value: expect.objectContaining({ onboarded: true }),
    }),
  ]);
  await page.reload();
  await expect(page.locator('.paste-page')).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/paste$/);
});

test('GUIDE-02：跳过后不重现，设置复看焦点受限、Escape 与浏览器返回先关引导', async ({
  page,
}, info) => {
  await openShelf(page);
  await page.reload();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await page
    .getByRole('button', { name: '设置与数据管理', exact: true })
    .click();
  const before = (await updateData(page)).settings;
  const opener = page.getByRole('button', {
    name: '查看使用引导与安装方法',
    exact: true,
  });
  await keyboardActivate(page, opener);
  const dialog = page.getByRole('dialog', { name: '微光阅读使用引导' });
  await checkGuide(page, '你的书只在这台设备上');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await keyboardActivate(page, opener);
  await checkGuide(page, '你的书只在这台设备上');
  await page.evaluate(() => history.back());
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(opener).toBeFocused();
  expect((await updateData(page)).settings).toEqual(before);
  await opener.click();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await checkGuide(page, '添加到主屏幕');
  await page.screenshot({
    path: info.outputPath('guide-settings-narrow.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '关闭引导', exact: true }).click();
  await expect(opener).toBeFocused();
  // UI dismissal withdraws the modal's native history entry asynchronously.
  // Verify that withdrawal completes before issuing a second browser Back.
  await expect
    .poll(() => page.evaluate(() => history.state?.jingyeOverlay ?? null))
    .toBeNull();
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole('button', { name: '导入第一本书', exact: true }),
  ).toBeVisible();
});

const environments = [
  {
    label: '微信',
    ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 MicroMessenger/8.0.50',
    kind: 'inApp:微信',
    text: '当前为微信内置浏览器',
  },
  {
    label: 'QQ',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 QQ/9.0.0',
    kind: 'inApp:QQ',
    text: '当前为QQ内置浏览器',
  },
  {
    label: '旧iOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 Version/16.3 Mobile/15E148 Safari/604.1',
    kind: 'olderIos',
    text: '当前 iOS 低于 16.4',
  },
];
for (const environment of environments) {
  test(`ENV-${environment.label}：模拟 UA 提示可关闭并跨重载保留，无外部请求`, async ({
    page,
  }, info) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, 'userAgent', { get: () => ua });
    }, environment.ua);
    await info.attach('simulated-environment', {
      body: Buffer.from(
        JSON.stringify({ userAgent: environment.ua, realSystemBrowser: false }),
      ),
      contentType: 'application/json',
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const notice = page.getByRole('complementary', { name: '浏览器使用提示' });
    await expect(notice).toContainText(environment.text);
    await page.screenshot({
      path: info.outputPath('environment-notice.png'),
      fullPage: true,
    });
    await keyboardActivate(
      page,
      page.getByRole('button', { name: '关闭浏览器提示，不再显示' }),
    );
    await expect(notice).toHaveCount(0);
    await expect
      .poll(async () => JSON.stringify((await updateData(page)).settings))
      .toContain(environment.kind);
    await page.getByRole('button', { name: '跳过引导', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '导入第一本书', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: '导入第一本书', exact: true }),
    ).toBeVisible();
    await expect(notice).toHaveCount(0);
    await page
      .getByRole('button', { name: '设置与数据管理', exact: true })
      .click();
    await expect(notice).toHaveCount(0);
  });
}

test('GUIDE-03：受控安装事件仅可信点击触发，取消与确认状态不阻挡阅读', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0',
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await checkGuide(page, '添加到主屏幕');
  await page.evaluate(() => {
    const calls: { trustedClick: boolean; activeGesture: boolean | null }[] =
      [];
    Reflect.set(window, 'installTestCalls', calls);
    let trustedClick = false;
    document.addEventListener(
      'click',
      (event) => {
        trustedClick = event.isTrusted;
      },
      true,
    );
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: async () => {
          calls.push({
            trustedClick,
            activeGesture: navigator.userActivation?.isActive ?? null,
          });
        },
      },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) },
    });
    window.dispatchEvent(event);
  });
  const install = page.getByRole('button', {
    name: '安装微光阅读',
    exact: true,
  });
  await expect(install).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, 'installTestCalls')),
  ).toEqual([]);
  await install.click();
  await expect(page.getByRole('status')).toContainText('已取消安装');
  const calls: unknown = await page.evaluate(() =>
    Reflect.get(window, 'installTestCalls'),
  );
  expect(calls).toEqual([expect.objectContaining({ trustedClick: true })]);
  await info.attach('controlled-install-event', {
    body: Buffer.from(JSON.stringify({ actualSystemInstall: false, calls })),
    contentType: 'application/json',
  });
  await expect(install).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(
    page.getByText('已安装，可从主屏幕打开。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '开始使用', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '导入第一本书', exact: true }),
  ).toBeVisible();
});

test('GUIDE-04：真实 IDB 写入故障明确提示，本次先阅读不伪造完成标志', async ({
  page,
}) => {
  await page.goto('/');
  await checkGuide(page, '你的书只在这台设备上');
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'settings')
        throw new DOMException(
          'Controlled write failure',
          'QuotaExceededError',
        );
      return native.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '跳过引导', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('引导记录未能保存');
  await page.getByRole('button', { name: '本次先阅读', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '导入第一本书', exact: true }),
  ).toBeVisible();
  expect((await updateData(page)).settings).toEqual([]);
  await page.reload();
  await checkGuide(page, '你的书只在这台设备上');
});
