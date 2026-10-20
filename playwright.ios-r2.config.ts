import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  globalSetup: ['./e2e/sharingSetup.ts'],
  testDir: './e2e',
  testMatch: [
    'ios-r2.spec.ts',
    'reader-fixes.spec.ts',
    'speech.spec.ts',
    'reading.spec.ts',
    'sharing.spec.ts',
  ],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/ios-r2-browser-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4180',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    { name: 'WebKit', use: { ...devices['iPhone 14'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});
