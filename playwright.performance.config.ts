import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  globalSetup: './e2e/performanceSetup.ts',
  testMatch: 'performance.spec.ts',
  timeout: 180_000,
});
