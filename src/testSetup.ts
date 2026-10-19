import { beforeEach } from 'vitest';
import { setWorkerLanguage } from '@/i18n';

// Existing regression cases exercise Chinese UI and errors. Language-specific
// cases select their own preference explicitly, just as the browser suites do.
if (typeof navigator !== 'undefined') {
  Object.defineProperties(navigator, {
    language: { configurable: true, get: () => 'zh-CN' },
    languages: { configurable: true, get: () => ['zh-CN'] },
  });
}
beforeEach(() => setWorkerLanguage('zh-Hans'));
