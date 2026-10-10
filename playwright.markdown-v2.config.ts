import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: [
    'markdown.spec.ts',
    'markdownV2.spec.ts',
    'pagination.spec.ts',
    'image-layout.spec.ts',
  ],
  timeout: 120_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/markdown-v2-browser-results.json' }],
  ],
});
