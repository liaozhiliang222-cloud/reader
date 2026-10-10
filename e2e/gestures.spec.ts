import type { CDPSession, Page } from '@playwright/test';
import { test, expect } from './experienceFixtures';
import {
  openShelf,
  importBook,
  menu,
  choose,
  selectVisibleText,
} from './helpers';
import { updateData } from './updateData';

test.use({ reducedMotion: 'no-preference' });

async function prepare(page: Page) {
  await openShelf(page);
  await importBook(page, 'txt');
  await menu(page);
  if (await page.evaluate(() => document.fullscreenElement !== null))
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await choose(page, '翻页动效', '平移');
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await page.evaluate(() => {
    const events: {
      type: string;
      trusted: boolean;
      pointerType: string;
      x: number;
      y: number;
    }[] = [];
    Reflect.set(window, 'gestureTestEvents', events);
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
    ]) {
      document.addEventListener(
        type,
        (event) => {
          if (event instanceof PointerEvent)
            events.push({
              type,
              trusted: event.isTrusted,
              pointerType: event.pointerType,
              x: event.clientX,
              y: event.clientY,
            });
        },
        true,
      );
    }
  });
}

async function touch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  x: number,
  y: number,
) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints:
      type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }],
  });
}
async function startPoint(page: Page) {
  const rect = await page.locator('.reader-viewport').boundingBox();
  if (!rect) throw new Error('No reader viewport');
  return { x: rect.x + rect.width * 0.78, y: rect.y + rect.height * 0.55 };
}
async function transform(page: Page) {
  return page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((element) => (element as HTMLElement).style.transform);
}

test('GESTURE-01：Chromium 可信触摸慢拖超过 500ms 仍跟手、只翻一页并保存原件', async ({
  page,
  context,
}, info) => {
  await prepare(page);
  const original = (await updateData(page)).blobs;
  const session = await context.newCDPSession(page);
  const point = await startPoint(page);
  const before = await transform(page);
  await touch(session, 'touchStart', point.x, point.y);
  await touch(session, 'touchMove', point.x - 30, point.y);
  await expect.poll(() => transform(page)).not.toBe(before);
  await page.waitForTimeout(600); // The actual gesture, not the window clock, exceeds 500ms.
  await touch(session, 'touchMove', point.x - 100, point.y);
  const moved = await transform(page);
  expect(moved).not.toBe(before);
  await touch(session, 'touchEnd', point.x - 100, point.y);
  await expect(page.locator('.reader-footer')).toHaveText(/^2 \/ /);
  await page.waitForTimeout(250);
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  const events: unknown = await page.evaluate(() =>
    Reflect.get(window, 'gestureTestEvents'),
  );
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'pointermove',
        trusted: true,
        pointerType: 'touch',
      }),
      expect.objectContaining({
        type: 'pointerup',
        trusted: true,
        pointerType: 'touch',
      }),
    ]),
  );
  await info.attach('native-touch', {
    body: Buffer.from(
      JSON.stringify({ physicalDevice: false, before, moved, events }),
    ),
    contentType: 'application/json',
  });
  expect((await updateData(page)).blobs).toEqual(original);
  await page.screenshot({ path: info.outputPath('slow-drag-complete.png') });
  await session.detach();
});

test('GESTURE-02：小幅拖动与原生取消复位，竖向手势不翻页', async ({
  page,
  context,
}, info) => {
  await prepare(page);
  const session = await context.newCDPSession(page);
  const point = await startPoint(page);
  const before = await transform(page);
  await touch(session, 'touchStart', point.x, point.y);
  await touch(session, 'touchMove', point.x - 20, point.y);
  await page.waitForTimeout(150);
  await touch(session, 'touchEnd', point.x - 20, point.y);
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  await expect.poll(() => transform(page)).toBe(before);
  await touch(session, 'touchStart', point.x, point.y);
  await touch(session, 'touchMove', point.x - 60, point.y);
  await expect.poll(() => transform(page)).not.toBe(before);
  await touch(session, 'touchCancel', point.x - 60, point.y);
  await expect.poll(() => transform(page)).toBe(before);
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  await touch(session, 'touchStart', point.x, point.y);
  await touch(session, 'touchMove', point.x + 5, point.y - 100);
  await touch(session, 'touchEnd', point.x + 5, point.y - 100);
  await expect.poll(() => transform(page)).toBe(before);
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  const events: unknown = await page.evaluate(() =>
    Reflect.get(window, 'gestureTestEvents'),
  );
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'pointercancel',
        trusted: true,
        pointerType: 'touch',
      }),
    ]),
  );
  await info.attach('native-touch-cancellation', {
    body: Buffer.from(JSON.stringify({ physicalDevice: false, events })),
    contentType: 'application/json',
  });
  await session.detach();
});

test('GESTURE-03：选区阻止可信滑动翻页，菜单开启时先关闭且页码不变', async ({
  page,
  context,
}) => {
  await prepare(page);
  const session = await context.newCDPSession(page);
  const point = await startPoint(page);
  const text = await selectVisibleText(page);
  expect(text.length).toBeGreaterThan(0);
  await touch(session, 'touchStart', point.x, point.y);
  await touch(session, 'touchMove', point.x - 100, point.y);
  await touch(session, 'touchEnd', point.x - 100, point.y);
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  await page.evaluate(() => {
    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await menu(page);
  const upper = await page.locator('.reader-viewport').boundingBox();
  if (!upper) throw new Error('No reader viewport');
  const y = upper.y + 40;
  await touch(session, 'touchStart', point.x, y);
  await touch(session, 'touchMove', point.x - 100, y);
  await touch(session, 'touchEnd', point.x - 100, y);
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  await session.detach();
});
