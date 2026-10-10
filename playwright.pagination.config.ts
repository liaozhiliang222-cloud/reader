import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'pagination.spec.ts',
  // Pixel tests create their EPUB in memory. Avoid replacing the run manifests
  // of a completed full suite while checking a deliberate layout mutation.
  globalSetup: undefined,
});
