import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: [
    './e2e/globalSetup.ts',
    './e2e/preferencesSetup.ts',
    './e2e/longChapterSetup.ts',
    './e2e/performanceSetup.ts',
    './e2e/sharingSetup.ts',
    './e2e/interactionSetup.ts',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixels: 0 } },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'artifacts/full-browser-results.json' }],
  ],
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:4180',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'Pixel-7',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'iPhone-14',
      testIgnore: 'gestures.spec.ts',
      use: { ...devices['iPhone 14'], browserName: 'webkit' },
    },
  ],
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});
