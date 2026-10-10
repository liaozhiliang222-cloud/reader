import { test as base, expect } from '@playwright/test';

// Windows WebKit ephemeral contexts cannot persist Blob in IndexedDB.
// Use a new temporary on-disk profile per test; never the user's browser profile.
// Reproduce independently with scripts/probe-webkit-storage.mjs.
export const test = base.extend<{
  expectCspViolations: boolean;
  cspGuard: void;
}>({
  expectCspViolations: [false, { option: true }],
  cspGuard: [
    async ({ context, expectCspViolations }, use) => {
      const violations: string[] = [];
      await context.exposeBinding(
        'reportCspViolation',
        (_source, event: { directive: string; uri: string }) => {
          violations.push(`${event.directive}: ${event.uri}`);
        },
      );
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report: unknown = Reflect.get(window, 'reportCspViolation');
          if (typeof report === 'function')
            void report({
              directive: event.violatedDirective,
              uri: event.blockedURI,
            });
        });
      });
      context.on('page', (page) => {
        page.on('console', (message) => {
          if (
            /content.security.policy|violat.{0,20}(csp|directive)/i.test(
              message.text(),
            )
          )
            violations.push(message.text());
        });
      });
      await use();
      if (!expectCspViolations)
        expect(violations, '正常流程不应触发 CSP 违规').toEqual([]);
    },
    { auto: true },
  ],
  context: async (
    {
      context,
      browserName,
      playwright,
      contextOptions,
      baseURL,
      locale,
      timezoneId,
      colorScheme,
      reducedMotion,
      userAgent,
      viewport,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      serviceWorkers,
      launchOptions,
    },
    use,
  ) => {
    if (process.platform !== 'win32' || browserName !== 'webkit') {
      await use(context);
      return;
    }
    const isolated = await playwright.webkit.launchPersistentContext('', {
      ...launchOptions,
      ...contextOptions,
      headless: true,
      baseURL,
      locale,
      timezoneId,
      colorScheme,
      reducedMotion,
      userAgent,
      viewport,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      serviceWorkers,
      acceptDownloads: true,
    });
    try {
      await use(isolated);
    } finally {
      await isolated.close();
    }
  },
});
export { expect } from '@playwright/test';
