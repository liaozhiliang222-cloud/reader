import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  globalSetup: './e2e/interactionSetup.ts',
  testMatch: 'interactions.spec.ts',
  timeout: 120_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/interactions-results.json' }],
  ],
});
