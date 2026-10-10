import { defineConfig } from '@playwright/test';
import deployment from './playwright.deployment.config';

export default defineConfig({
  ...deployment,
  globalSetup: './e2e/liveUpdateSetup.ts',
  testMatch: ['deployment-update.live.ts'],
  workers: 2,
  timeout: 900_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/deployment-update-results.json' }],
  ],
});
