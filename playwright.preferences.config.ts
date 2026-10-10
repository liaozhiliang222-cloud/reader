import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  globalSetup: './e2e/preferencesSetup.ts',
  testMatch: 'preferences.spec.ts',
  timeout: 120_000,
});
