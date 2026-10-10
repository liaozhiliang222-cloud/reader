import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  globalSetup: './e2e/compatibilitySetup.ts',
  testMatch: 'real-epub.compat.ts',
  timeout: 120_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/compatibility-results.json' }],
  ],
});
