import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: 'markdown.spec.ts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/markdown-browser-results.json' }],
  ],
});
