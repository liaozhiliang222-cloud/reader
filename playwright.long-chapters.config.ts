import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  globalSetup: './e2e/longChapterSetup.ts',
  testMatch: 'long-chapters.spec.ts',
  timeout: 120_000,
});
