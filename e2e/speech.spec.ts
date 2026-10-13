import { test, expect } from './fixtures';
import { menu, openMore, paragraphs } from './helpers';
import { installSpeechBackend } from './speechBackend';
import type { Page } from '@playwright/test';

async function draft(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '跳过引导' }).click();
  await page.goto('/#/paste');
  await page.getByLabel('标题（选填）').fill('听书界面原创验收');
  await page.getByLabel('正文', { exact: true }).fill(paragraphs.join('\n\n'));
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await expect(page.locator('.reader-footer')).toHaveText(/1 \/ \d+/);
  await menu(page);
  await openMore(page);
  await page.getByRole('button', { name: '听书', exact: true }).click();
}

test('听书界面：外部暂停、手动浏览、同句续听与停止（无音频测试替身）', async ({
  page,
}) => {
  await installSpeechBackend(page);
  await draft(page);
  await page.getByRole('button', { name: '从本页听', exact: true }).click();
  const bar = page.getByRole('complementary', { name: '听书控制' });
  await expect(bar).toContainText('正在听书');
  await page.evaluate(() => {
    const backend = Reflect.get(window, '__speechBackendDouble') as {
      pause(): void;
    };
    backend.pause();
  });
  await expect(bar).toContainText('听书已暂停');
  await menu(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(bar).toContainText('浏览中 · 听书已暂停');
  await page.getByRole('button', { name: '继续听书', exact: true }).click();
  await expect(bar).toContainText('正在听书');
  await expect(bar).not.toContainText('浏览中');
  await expect(page.locator('.reader-footer')).toHaveText(/^1 \/ /);
  await page.getByLabel('听书语速').selectOption('1.25');
  await page.getByLabel('听书定时').selectOption('chapter');
  await page.setViewportSize({ width: 320, height: 740 });
  const geometry = await bar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      controls: [...element.querySelectorAll('button, select')].map(
        (control) => {
          const box = control.getBoundingClientRect();
          return { width: box.width, height: box.height };
        },
      ),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '停止听书', exact: true }).click();
  await expect(bar).toBeHidden();
});

test('无离线语音时禁止开始并提供系统设置入口（无音频测试替身）', async ({
  page,
}) => {
  await installSpeechBackend(page, false);
  await draft(page);
  await expect(
    page.getByText('此引擎没有已安装的离线语音。', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '从本页听', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '系统语音设置', exact: true }),
  ).toBeVisible();
});
