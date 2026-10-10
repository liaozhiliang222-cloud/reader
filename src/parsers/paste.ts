import { cleanParagraphs } from './txt/clean';
import { splitChapters, type TextChapter } from './txt/chapters';
import { parseMarkdown, type DraftFormat } from './markdown';
import { bookIdForHash, sourceHash } from './identity';

export interface DraftChapter extends TextChapter {
  level: number;
}
const heading = /^(#{1,6})\s+(.+)$/u;

export function splitDraft(text: string): DraftChapter[] {
  const lines = cleanParagraphs(text);
  if (!lines.some((line) => heading.test(line)))
    return splitChapters(text).map((chapter) => ({ ...chapter, level: 0 }));
  const chapters: DraftChapter[] = [];
  let title = '前言',
    level = 0,
    paragraphs: string[] = [],
    charStart = 0;
  let hasHeading = false;
  const append = () => {
    const charCount = paragraphs.reduce((sum, p) => sum + p.length, 0);
    chapters.push({
      index: chapters.length,
      title,
      level,
      paragraphs,
      charStart,
      charCount,
    });
    charStart += charCount;
  };
  for (const line of lines) {
    const match = heading.exec(line);
    if (!match) {
      paragraphs.push(line);
      continue;
    }
    if (hasHeading || paragraphs.length) append();
    title = match[2]!.trim();
    level = match[1]!.length - 1;
    paragraphs = [];
    hasHeading = true;
  }
  if (hasHeading || paragraphs.length) append();
  return chapters;
}

export async function parseDraft(
  text: string,
  format: DraftFormat = 'plain',
  markdownVersion = 2,
) {
  if (!text.trim()) throw new Error('请先粘贴正文。');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > 50 * 1024 * 1024)
    throw new Error('文稿超过 50 MB，请拆分后导入。');
  if (format === 'markdown')
    return {
      ...parseMarkdown(text, markdownVersion),
      size: bytes.byteLength,
      id: bookIdForHash(
        { type: 'paste', draftFormat: 'markdown' },
        await sourceHash(bytes),
      ),
    };
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  // 类型前缀防止与相同字节的 TXT 原文件混为同一种书。
  const id =
    'paste:' +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  const first = cleanParagraphs(text)[0]!.replace(heading, '$2');
  const chapters = splitDraft(text);
  return {
    id,
    title: [...first].slice(0, 30).join(''),
    chapters,
    charCount: chapters.reduce((sum, chapter) => sum + chapter.charCount, 0),
    size: bytes.byteLength,
    markdownVersion: undefined,
    toc: chapters.map((c) => ({
      title: c.title,
      chapterIndex: c.index,
      paragraphIndex: 0,
      level: c.level,
    })),
  };
}
