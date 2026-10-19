// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { en } from './en';
import {
  languagePreference,
  resolveLanguage,
  translate,
  uiLanguage,
  setLanguagePreference,
  resetLanguagePreference,
} from './index';
import { notesMarkdown, notesFilename } from '@/reader/exportNotes';
import { reviewMarkdown, reviewNotes } from '@/reader/notesReview';

afterEach(() => {
  vi.restoreAllMocks();
  resetLanguagePreference();
});
it('按系统语言优先级选择中英文，其他语言回退英文', () => {
  for (const language of ['zh-CN', 'zh-Hans-CN', 'zh-TW', 'ZH-hk'])
    expect(resolveLanguage([language])).toBe('zh-Hans');
  expect(resolveLanguage(['en-GB', 'zh-CN'])).toBe('en');
  expect(resolveLanguage(['fr-FR', 'en-US'])).toBe('en');
  expect(resolveLanguage(['ja-JP'])).toBe('en');
  expect(resolveLanguage([])).toBe('en');
});
it('语言选择只写本地偏好；写入失败时不切换语言', () => {
  setLanguagePreference('en');
  expect(uiLanguage.value).toBe('en');
  expect(localStorage.getItem('weiguang.ui.language')).toBe('en');
  vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw Error('full');
  });
  expect(() => setLanguagePreference('zh-Hans')).toThrow('full');
  expect(languagePreference.value).toBe('en');
});
it('导出插值不二次替换用户正文，也不解析 HTML', () => {
  expect(translate('en', '阅读《{0}》', '{1}<img onerror=x>')).toBe(
    'Read “{1}<img onerror=x>”',
  );
  expect(translate('zh-Hans', '阅读《{0}》', 'Original')).toBe(
    '阅读《Original》',
  );
});
it('英文目录完整，所有占位符与中文原文一致', () => {
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [source, english] of Object.entries(en)) {
    expect(english.trim(), source).not.toBe('');
    expect(english, source).not.toMatch(/\p{Script=Han}/u);
    expect(placeholders(english), source).toEqual(placeholders(source));
  }
});
it('英文导出只翻译说明，保留书名、摘录、想法、标签和本机链接', () => {
  setLanguagePreference('en');
  const note = {
    id: 'note',
    bookId: 'original',
    chapterIndex: 0,
    start: { paragraphIndex: 0, charOffset: 0 },
    end: { paragraphIndex: 0, charOffset: 4 },
    text: '原文 {0} 😀',
    note: '自己的想法',
    tags: ['安静', 'reading'],
    color: 'yellow' as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const chapters = [{ index: 0, title: '第一章', charStart: 0, charCount: 4 }];
  const book = { title: '我的书', author: '原作者' };
  const markdown = notesMarkdown(book, chapters, [note]);
  expect(markdown).toContain('Author: 原作者');
  expect(markdown).toContain('**Note**');
  expect(markdown).toContain('自己的想法');
  expect(markdown).toContain('原文 \\{0\\} 😀');
  expect(notesFilename('我的书')).toBe('我的书_Notes.md');
  const rows = reviewNotes(
    [],
    [{ ...note, archivedSource: { title: '我的书', chapterTitle: '第一章' } }],
  );
  const exported = reviewMarkdown(rows, 'reading');
  expect(exported).toContain('# LumiRead Notes');
  expect(exported).toContain('**Review**');
  expect(exported).toContain('Tags: 安静, reading');
  expect(exported).toContain('我的书');
});
