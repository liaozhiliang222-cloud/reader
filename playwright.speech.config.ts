import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'speech.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/speech-ui-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4184',
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
    command: 'pnpm preview --host 127.0.0.1 --port 4184 --strictPort',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: false,
  },
});
