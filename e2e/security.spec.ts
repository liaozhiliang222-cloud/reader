import { test, expect } from './fixtures';
import { openShelf } from './helpers';
import { compatibilityEpub } from '../src/parsers/epub/compatFixtures';

test('恶意 EPUB 的脚本、外部图片、表单和 iframe 被净化，正常阅读无 CSP 错误', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== 'http://127.0.0.1:4180'
    )
      external.push(request.url());
  });
  await openShelf(page);
  await page.getByRole('button', { name: '导入第一本书' }).click();
  await page.getByLabel('选择书籍文件').setInputFiles({
    name: '安全边界.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(
      await compatibilityEpub(
        '<script>document.documentElement.dataset.bookExecuted="yes"</script><iframe src="https://csp-probe.invalid/frame"></iframe><form action="https://csp-probe.invalid/form"><input /></form><p onclick="document.documentElement.dataset.bookExecuted=\'yes\'">这段正文应该保留。</p><img src="https://csp-probe.invalid/image" /><svg onload="document.documentElement.dataset.bookExecuted=\'yes\'"></svg>',
        '安全边界',
      ),
    ),
  });
  await expect(page.locator('.reader-footer')).toBeVisible();
  await expect(
    page.getByText('这段正文应该保留。', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.bookExecuted),
  ).toBeUndefined();
  await expect(
    page.locator(
      '.reader-content script, .reader-content iframe, .reader-content form, .reader-content [onclick], .reader-content [onload]',
    ),
  ).toHaveCount(0);
  expect(external).toEqual([]);
});

test.describe('CSP 预期阻断', () => {
  test.use({ expectCspViolations: true, serviceWorkers: 'block' });
  for (const delivery of ['响应头和 meta', '仅 meta 兜底'] as const) {
    test(`${delivery}阻止内联脚本、外部连接和嵌入页面`, async ({ page }) => {
      let outbound = 0;
      await page.route('https://csp-probe.invalid/**', (route) => {
        outbound++;
        return route.abort();
      });
      if (delivery === '仅 meta 兜底') {
        await page.route('http://127.0.0.1:4180/', async (route) => {
          const response = await route.fetch(),
            headers = response.headers();
          delete headers['content-security-policy'];
          await route.fulfill({ response, headers });
        });
      }
      const response = await page.goto('/');
      if (delivery === '响应头和 meta') {
        expect(response!.headers()['content-security-policy']).toContain(
          "frame-ancestors 'none'",
        );
        expect(response!.headers()['x-content-type-options']).toBe('nosniff');
      }
      expect(
        await page
          .locator('meta[http-equiv="Content-Security-Policy"]')
          .getAttribute('content'),
      ).toContain("script-src 'self'");
      await expect(
        page.getByRole('button', { name: '跳过引导' }),
      ).toBeVisible();
      const result = await page.evaluate(async () => {
        const blocked: string[] = [];
        Reflect.set(window, 'blockedSecurityDirectives', blocked);
        document.addEventListener('securitypolicyviolation', (event) =>
          blocked.push(event.effectiveDirective),
        );
        const script = document.createElement('script');
        script.textContent =
          'document.documentElement.dataset.inlineExecuted="yes"';
        document.body.append(script);
        const frame = document.createElement('iframe');
        frame.src = 'https://csp-probe.invalid/frame';
        document.body.append(frame);
        const fetchBlocked = await fetch('https://csp-probe.invalid/data').then(
          () => false,
          () => true,
        );
        return {
          fetchBlocked,
          inlineExecuted: document.documentElement.dataset.inlineExecuted,
        };
      });
      expect(result).toEqual({ fetchBlocked: true, inlineExecuted: undefined });
      await expect
        .poll(() =>
          page.evaluate(() => Reflect.get(window, 'blockedSecurityDirectives')),
        )
        .toEqual(
          expect.arrayContaining([
            'script-src-elem',
            'connect-src',
            'frame-src',
          ]),
        );
      expect(outbound).toBe(0);
    });
  }
});
