import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  globalSetup: [],
  testMatch: ['i18n.spec.ts', 'ios-r2.spec.ts'],
  reporter: [['list'], ['json', { outputFile: 'artifacts/i18n-browser.json' }]],
});
