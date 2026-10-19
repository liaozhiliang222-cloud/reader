import { t } from '@/i18n';
import { groupHighlights } from './annotation';
import type { Book, ChapterSummary, Highlight } from '@/types';

function plainMarkdown(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}
export function notesMarkdown(
  book: Pick<Book, 'title' | 'author'>,
  chapters: readonly ChapterSummary[],
  items: readonly Highlight[],
) {
  const lines = [`# ${plainMarkdown(book.title.replace(/[\r\n]+/g, ' '))}`, ''];
  if (book.author)
    lines.push(
      t('作者：{0}', plainMarkdown(book.author.replace(/[\r\n]+/g, ' '))),
      '',
    );
  for (const group of groupHighlights(items)) {
    const chapter = chapters.find(
      (chapter) => chapter.index === group.chapterIndex,
    );
    lines.push(
      `## ${plainMarkdown((group.chapterIndex < 0 ? t('位置待确认（编码切换前的摘录）') : (chapter?.title ?? t('第 {0} 节', group.chapterIndex + 1))).replace(/[\r\n]+/g, ' '))}`,
      '',
    );
    for (const item of group.highlights) {
      lines.push(
        ...item.text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => `> ${plainMarkdown(line)}`),
        '',
      );
      if (item.note)
        lines.push(
          t('**笔记**'),
          '',
          plainMarkdown(item.note.replace(/\r\n?/g, '\n')),
          '',
        );
      lines.push(t('时间：{0}', new Date(item.createdAt).toISOString()), '');
    }
  }
  return lines.join('\n');
}
export function notesFilename(title: string) {
  const clean = [...title]
    .map((char) =>
      char.codePointAt(0)! < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char,
    )
    .join('')
    .trim();
  const safe = [...clean]
    .slice(0, 100)
    .join('')
    .replace(/[. ]+$/, '');
  return t('{0}_笔记.md', safe || t('微光阅读'));
}
