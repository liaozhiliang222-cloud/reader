import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const url = new URL(
  process.env.JINGYE_DEPLOY_URL ?? 'https://invalid.pages.dev',
);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.pages.dev'))
  throw new Error('JINGYE_DEPLOY_URL must be an HTTPS Pages origin');
if (!process.env.JINGYE_DEPLOY_URL)
  throw new Error('Set JINGYE_DEPLOY_URL to the actual deployed URL');

export default defineConfig({
  ...base,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'artifacts/deployment-browser-results.json' }],
  ],
  // Omit proxy environment variables only for isolated Windows WebKit HTTPS
  // tests: the live probe reproduces URL parsing failure with them present.
  projects: base.projects?.map((project) =>
    project.use?.browserName === 'webkit' && process.platform === 'win32'
      ? {
          ...project,
          use: {
            ...project.use,
            launchOptions: {
              env: Object.fromEntries(
                Object.entries(process.env).filter(
                  ([key]) => !/^(?:http|https|all|no)_proxy$/i.test(key),
                ),
              ),
            },
          },
        }
      : project,
  ),
  globalSetup: undefined,
  webServer: undefined,
  testMatch: ['deployment.live.ts', 'svg.spec.ts'],
  timeout: 120_000,
  use: { ...base.use, baseURL: url.origin },
});
