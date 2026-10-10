import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: ['onboarding.spec.ts', 'gestures.spec.ts'],
  // Playwright exposes native touch move through CDP only on Chromium.
  // WebKit still runs all onboarding/keyboard cases; no simulated touch pass.
  projects: base.projects?.map((project) =>
    project.use?.browserName === 'webkit'
      ? { ...project, testIgnore: 'gestures.spec.ts' }
      : project,
  ),
  timeout: 90_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/experience-browser-results.json' }],
  ],
});
