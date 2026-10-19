import { test, expect } from './fixtures';
import { openShelf } from './helpers';
import packageInfo from '../package.json' with { type: 'json' };
const { version } = packageInfo;

test('关于隐私、版本与本地许可证', async ({ page, context }, info) => {
  const external: string[] = [];
  context.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== 'http://127.0.0.1:4180'
    )
      external.push(request.url());
  });
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await page.getByRole('button', { name: '关于微光阅读与隐私' }).click();
  await expect(page.getByRole('heading', { name: '关于微光阅读' })).toBeVisible();
  await expect(
    page.getByText(`版本 ${version}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '隐私与本地数据' }),
  ).toContainText('我们不收集任何阅读数据。');
  await expect(page.locator('.feedback-template')).toContainText(
    `微光阅读 ${version}`,
  );
  await expect(
    page.getByRole('link', { name: '查看项目源码' }),
  ).toHaveAttribute('href', 'https://github.com/liaozhiliang222-cloud/reader');
  const issue = new URL(
    (await page
      .getByRole('link', { name: '在 GitHub 反馈' })
      .getAttribute('href'))!,
  );
  expect(issue.pathname).toBe('/liaozhiliang222-cloud/reader/issues/new');
  expect(issue.searchParams.get('body')).toBe(
    await page.locator('.feedback-template').textContent(),
  );
  const mail = new URL(
    (await page
      .getByRole('link', { name: '邮件反馈：liaozhiliang222@gmail.com' })
      .getAttribute('href'))!,
  );
  expect(mail.protocol).toBe('mailto:');
  expect(mail.pathname).toBe('liaozhiliang222@gmail.com');
  expect(mail.searchParams.get('body')).toBe(issue.searchParams.get('body'));
  await expect(
    page.getByText('项目许可证尚未确定；第三方组件与字体沿用各自许可。'),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('about.png'), fullPage: true });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '查看完整第三方许可' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('comlink@4.4.2');
  await expect(popup.locator('body')).toContainText('Apache License');
  await popup.close();
  await page.getByRole('button', { name: '返回设置' }).click();
  await expect(
    page.getByRole('heading', { name: '设置', exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
});
