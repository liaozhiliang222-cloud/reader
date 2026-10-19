import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';
import {
  openShelf,
  importBook,
  menu,
  backToShelf,
  selectVisibleText,
  paragraphs,
  choose,
  openMore,
} from './helpers';
import {
  interactionEvidence,
  observeInteractions,
  settleReader,
} from './interactionProbe';
import { textGeometry } from './layoutAssertions';
import { updateData } from './updateData';

const test = base.extend<{ interactionEvidence: void }>({
  interactionEvidence: [
    async ({ page, baseURL }, use, info) => {
      const errors: string[] = [],
        external: string[] = [],
        workers: string[] = [];
      if (!baseURL) throw Error('No test origin');
      const origin = new URL(baseURL).origin;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('worker', (worker) => workers.push(worker.url()));
      page.on('request', (request) => {
        if (
          /^https?:/.test(request.url()) &&
          new URL(request.url()).origin !== origin
        )
          external.push(request.url());
      });
      await observeInteractions(page);
      await use();
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      const run = process.env.JINGYE_INTERACTIONS_RUN;
      if (!run) throw Error('Missing interaction run');
      const manifest = JSON.parse(
        await readFile('artifacts/interactions-run.json', 'utf8'),
      ) as { runId: string; reports: string };
      expect(manifest.reports).toBe(run);
      const evidence = await interactionEvidence(page);
      expect(evidence.pointers.filter((event) => !event.trusted)).toEqual([]);
      await info.attach('interaction-diagnostic', {
        body: Buffer.from(
          JSON.stringify({
            footer: await page.locator('.reader-footer').allTextContents(),
            menuOpen: await page
              .locator('.reader-menu-toggle')
              .evaluateAll((elements) =>
                elements.map((element) =>
                  element.getAttribute('aria-expanded'),
                ),
              ),
            evidence,
          }),
        ),
        contentType: 'application/json',
      });
      if (info.status === 'passed') {
        const data = await updateData(page);
        const source = Buffer.from(
          '第一章 安静的书页\n\n' + paragraphs.join('\n\n'),
        );
        const originalSha256 = createHash('sha256')
          .update(source)
          .digest('hex');
        expect(data.blobs).toHaveLength(1);
        expect(data.blobs![0]).toMatchObject({
          size: source.length,
          sha256: originalSha256,
        });
        expect(workers.some((url) => new URL(url).origin === origin)).toBe(
          true,
        );
        const path = join(
          run,
          `${info.project.name}-${info.title.split('：')[0]}.json`,
        );
        const report = {
          runId: manifest.runId,
          checkedAt: new Date().toISOString(),
          engine: info.project.name,
          title: info.title,
          origin,
          errors,
          external,
          workers,
          evidence,
          nativeTouchInput: evidence.pointers.some(
            (event) => event.pointerType === 'touch',
          ),
          nativeAnimationObserver: true,
          rawOriginalHashPreserved: true,
          originalSha256,
          automaticCspGuard: true,
          physicalDeviceAcceptance: false,
        };
        await writeFile(path, JSON.stringify(report, null, 2) + '\n');
        await info.attach('interaction-evidence', {
          path,
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});
test.use({ reducedMotion: 'no-preference' });

async function prepare(page: Page) {
  await openShelf(page);
  const title = await importBook(page, 'txt');
  await menu(page);
  await openMore(page);
  await page.getByLabel('安静提示').uncheck();
  if (await page.evaluate(() => document.fullscreenElement !== null)) {
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
  }
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  return title;
}
async function controls(page: Page) {
  await menu(page);
  if (!(await page.locator('.typography-panel').count()))
    await page.getByRole('button', { name: '排版与主题', exact: true }).click();
}
async function mode(page: Page, value: 'normal' | 'oneHand') {
  await controls(page);
  await choose(page, '点按模式', value === 'oneHand' ? '单手模式' : '左右翻页');
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
}
async function animationMode(page: Page, value: 'none' | 'fade' | 'slide') {
  await controls(page);
  await choose(
    page,
    '翻页动效',
    { none: '无', fade: '淡入', slide: '平移' }[value],
  );
  await page.getByRole('button', { name: '排版与主题', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
}
async function tap(page: Page, fraction: number, expectedPage?: number) {
  const rect = await page.locator('.reader-viewport').boundingBox();
  if (!rect) throw Error('No reader frame');
  await page.touchscreen.tap(
    rect.x + rect.width * fraction,
    rect.y + rect.height * 0.55,
  );
  if (expectedPage !== undefined)
    await expect(page.locator('.reader-footer')).toHaveText(
      new RegExp(`^${expectedPage} /`),
    );
  await settleReader(page);
}
async function resize(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await settleReader(page);
}
async function column(page: Page) {
  const footer = await page.locator('.reader-footer').innerText();
  const match = footer.match(/^(\d+) \/ (\d+)/);
  if (!match) throw Error('Missing page information');
  const transform = await page
    .locator('.reader-content:not([aria-hidden="true"])')
    .evaluate((root) => (root as HTMLElement).style.transform);
  return { page: Number(match[1]), pages: Number(match[2]), transform };
}
async function corner(page: Page) {
  const button = page.getByRole('button', {
    name: '单手模式：上一页',
    exact: true,
  });
  const rect = await button.boundingBox();
  if (!rect) throw Error('No previous corner');
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

async function screenshot(page: Page, name: string) {
  const run = process.env.JINGYE_INTERACTIONS_RUN;
  if (!run) throw Error('No screenshot run');
  const path = join(run, name + '.png');
  await page.screenshot({ path });
}

test('M2-05-REGIONS：双侧触摸、左上返回与正文点按只关菜单，横竖窗和重载保留', async ({
  page,
}, info) => {
  const title = await prepare(page);
  await mode(page, 'oneHand');
  await tap(page, 0.15, 2);
  await screenshot(page, info.project.name + '-one-hand-portrait');
  await tap(page, 0.85, 3);
  await corner(page);
  await expect(page.locator('.reader-footer')).toHaveText(/^2 \//);
  await settleReader(page);
  await tap(page, 0.5);
  await expect(
    page.getByRole('button', { name: '阅读菜单', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  const before = await page.locator('.reader-footer').innerText();
  await tap(page, 0.15);
  await expect(
    page.locator('.reader-footer'),
    '菜单打开时正文点击只能关闭菜单',
  ).toHaveText(before);
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await tap(page, 0.85, 3);
  const viewport = page.viewportSize()!;
  await resize(page, { width: viewport.height, height: viewport.width });
  const landscapeBefore = await column(page);
  await screenshot(page, info.project.name + '-one-hand-landscape');
  await tap(page, 0.15, landscapeBefore.page + 1);
  await corner(page);
  await expect(page.locator('.reader-footer')).toHaveText(
    new RegExp(`^${landscapeBefore.page} /`),
  );
  await settleReader(page);
  expect(await column(page)).toEqual(landscapeBefore);
  await resize(page, viewport);
  await textGeometry(page);
  const footer = await page.locator('.reader-footer').innerText();
  await backToShelf(page);
  await page.reload();
  await page.locator('.shelf-entry').filter({ hasText: title }).click();
  await expect(page.locator('.reader-footer')).toHaveText(footer);
  await expect(
    page.getByLabel('单手模式：上一页', { exact: true }),
  ).toBeVisible();
  await mode(page, 'normal');
  const normalBefore = await column(page);
  await tap(page, 0.15, normalBefore.page - 1);
  await tap(page, 0.85, normalBefore.page);
  expect(await column(page)).toEqual(normalBefore);
});

test('M2-05-SELECTION：文字选区和笔记编辑时触摸返回不翻页，退出后可继续', async ({
  page,
}, info) => {
  await prepare(page);
  await mode(page, 'oneHand');
  await tap(page, 0.85, 2);
  await selectVisibleText(page);
  await expect(page.getByLabel('文字选区操作')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '单手模式：上一页', exact: true }),
  ).toBeDisabled();
  await screenshot(page, info.project.name + '-selected-corner-disabled');
  const before = await page.locator('.reader-footer').innerText();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.reader-footer')).toHaveText(before);
  await corner(page);
  await expect(
    page.locator('.reader-footer'),
    '选区优先，单手返回不能翻页',
  ).toHaveText(before);
  await page.getByRole('button', { name: '阅读菜单', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await selectVisibleText(page);
  await page
    .getByLabel('文字选区操作')
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '编辑笔记', exact: true });
  await editor.getByLabel('写下此刻的想法').fill('触摸不会误翻页。');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.reader-footer')).toHaveText(before);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await tap(page, 0.85, 3);
  await textGeometry(page);
  const data = await updateData(page);
  expect(data.highlights).toHaveLength(1);
});

test('M2-04-MOTION：原生平移/淡入/无动效、实时减弱动态取消与恢复', async ({
  page,
}) => {
  await prepare(page);
  await tap(page, 0.85, 2);
  let evidence = await interactionEvidence(page);
  expect(evidence.animations).toHaveLength(1);
  expect(evidence.animations[0]).toMatchObject({
    duration: 220,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    initialState: 'running',
  });
  expect(evidence.animations[0]!.frames.length).toBeGreaterThan(0);
  expect(
    evidence.animations[0]!.keyframes.every((frame) => 'transform' in frame),
  ).toBe(true);
  await animationMode(page, 'fade');
  await tap(page, 0.85, 3);
  evidence = await interactionEvidence(page);
  expect(evidence.animations).toHaveLength(2);
  expect(evidence.animations[1]).toMatchObject({
    duration: 160,
    easing: 'ease-out',
    initialState: 'running',
  });
  expect(
    evidence.animations[1]!.frames.some(
      (frame) => Number(frame.opacity) > 0 && Number(frame.opacity) < 1,
    ),
  ).toBe(true);
  await animationMode(page, 'none');
  await tap(page, 0.85, 4);
  expect((await interactionEvidence(page)).animations).toHaveLength(2);
  await animationMode(page, 'slide');
  // Hold a real native animation halfway through so a slow cross-process
  // emulateMedia call cannot arrive after its 220 ms natural finish.
  // Durations, easing and running frames were verified above without pausing.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (this.matches('.reader-content')) {
        Element.prototype.animate = animate;
        animation.pause();
        animation.currentTime = 110;
      }
      return animation;
    };
  });
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .querySelector('.reader-content:not([aria-hidden="true"])')
          ?.getAnimations()
          .some((animation) => animation.playState === 'paused'),
      ),
    )
    .toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(
      async () => (await interactionEvidence(page)).animations[2]?.cancelledAt,
    )
    .toBeDefined();
  expect(
    (await interactionEvidence(page)).animations[2]?.finishedAt,
    '必须取消正在进行的原生动画',
  ).toBeUndefined();
  await expect(page.locator('.reader-footer')).toHaveText(/^5 \//);
  await settleReader(page);
  await tap(page, 0.85, 6);
  expect((await interactionEvidence(page)).animations).toHaveLength(3);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await tap(page, 0.85, 7);
  expect((await interactionEvidence(page)).animations).toHaveLength(4);
  await textGeometry(page);
});

test('M2-04-OVERLAYS：菜单/抽屉原生退出不可交互，减弱动态无CSS动画', async ({
  page,
}) => {
  await prepare(page);
  await tap(page, 0.5);
  const before = await page.locator('.reader-footer').innerText();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await menu(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.locator('.reader-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-drawer')).toHaveCount(0);
  let evidence = await interactionEvidence(page);
  for (const [className, duration, easing] of [
    ['reader-menu', '0.18s', 'ease'],
    ['reader-drawer', '0.24s', 'ease-out'],
  ]) {
    const closed = evidence.overlays.filter(
      (item) =>
        item.className.includes(className!) &&
        item.className.includes('closing'),
    );
    expect(closed.length).toBeGreaterThan(0);
    for (const item of closed)
      expect(item).toMatchObject({
        inert: true,
        hidden: 'true',
        duration,
        easing,
        pointerEvents: 'none',
      });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await tap(page, 0.5);
  await expect(page.locator('.reader-menu')).toHaveCSS(
    'animation-name',
    'none',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.locator('.reader-drawer')).toHaveCSS(
    'animation-name',
    'none',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-drawer')).toHaveCount(0);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.reader-menu')).toHaveCount(0);
  await expect(page.locator('.reader-footer')).toHaveText(before);
  evidence = await interactionEvidence(page);
  expect(evidence.overlays.some((item) => item.name === 'none')).toBe(true);
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('[inert]') === null,
    ),
  ).toBe(true);
});
