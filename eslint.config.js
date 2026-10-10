import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'test-books/**',
      '.font-tools/**',
      '.e2e-update/**',
      '.e2e-long/**',
      '.e2e-performance/**',
      '.e2e-sharing/**',
      '.e2e-live-update/**',
      '.e2e-compat/**',
      '.e2e-interactions/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
