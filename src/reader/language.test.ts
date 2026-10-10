import { expect, it } from 'vitest';
import { contentLanguage } from './language';

it('拉丁字母为主的正文标为英文，中文或中英混排保持中文', () => {
  expect(
    contentLanguage(['CHAPTER VIII. CONCERNING THOSE WHO HAVE OBTAINED']),
  ).toBe('en');
  expect(contentLanguage(['窗外的风轻轻吹过，读书的人翻开新的一页。'])).toBe(
    'zh-CN',
  );
  expect(contentLanguage(['使用 TypeScript 和 Preact 编写的阅读器。'])).toBe(
    'zh-CN',
  );
  expect(contentLanguage(['', ''])).toBe('zh-CN');
});
