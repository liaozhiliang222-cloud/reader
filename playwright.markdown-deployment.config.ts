import { defineConfig } from '@playwright/test';
import deployment from './playwright.deployment.config';

export default defineConfig({
  ...deployment,
  testMatch: ['markdownV2.spec.ts'],
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/markdown-v2-deployment-results.json' }],
  ],
});
