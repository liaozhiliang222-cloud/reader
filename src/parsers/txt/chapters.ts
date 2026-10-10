import { cleanParagraphs } from './clean';

export interface TextChapter {
  index: number;
  title: string;
  paragraphs: string[];
  charStart: number;
  charCount: number;
}

export function isChapterTitle(line: string): boolean {
  if (line.length > 60 || [...line].length > 30) return false;
  return /^(?:第[零〇一二两三四五六七八九十百千万亿0-9０-９]+(?:[章节回卷集篇]|部(?:\s|[：:、.．·—-]|$))|chapter\s+\d+(?:\s|[.:：—-]|$)|(?:序章|楔子|前言|引子|后记|尾声|番外)(?:\s|[：:、·—-]|$))/iu.test(
    line,
  );
}

export function splitChapters(text: string): TextChapter[] {
  const paragraphs = cleanParagraphs(text);
  const chapters: TextChapter[] = [];
  let charStart = 0;
  const append = (title: string, body: string[]) => {
    const charCount = body.reduce(
      (count, paragraph) => count + paragraph.length,
      0,
    );
    chapters.push({
      index: chapters.length,
      title,
      paragraphs: body,
      charStart,
      charCount,
    });
    charStart += charCount;
  };
  if (!paragraphs.some(isChapterTitle)) {
    let group: string[] = [];
    let count = 0;
    for (const paragraph of paragraphs) {
      if (count >= 5000) {
        append(`第 ${chapters.length + 1} 部分`, group);
        group = [];
        count = 0;
      }
      group.push(paragraph);
      count += paragraph.length;
    }
    if (group.length) append(`第 ${chapters.length + 1} 部分`, group);
    return chapters;
  }

  let title = '前言';
  let body: string[] = [];
  let hasTitle = false;
  for (const paragraph of paragraphs) {
    if (isChapterTitle(paragraph)) {
      if (hasTitle || body.length) append(title, body);
      title = paragraph;
      body = [];
      hasTitle = true;
    } else body.push(paragraph);
  }
  if (hasTitle || body.length) append(title, body);
  return chapters;
}
