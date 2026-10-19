import { t } from '@/i18n';
import type { ReviewNote } from './notesReview';

/** Wrap words where possible; split oversized tokens by Unicode code point. */
export function wrapQuote(
  text: string,
  measure: (text: string) => number,
  width = 820,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const token of text
    .replace(/\r\n?/g, '\n')
    .match(/\n|[^\S\n]+|[^\s]+/gu) ?? []) {
    if (token === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (measure(line + token) <= width) {
      line += token;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    for (const char of token) {
      if (line && measure(line + char) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
/** Each page preserves complete quote text; long excerpts split into numbered images. */
export async function quoteCards(row: ReviewNote): Promise<Blob[]> {
  if (row.item.text.length > 20000)
    throw new Error(t('摘录超过 2 万字，请使用 Markdown 导出保存完整内容。'));
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('无法生成摘录图片。'));
  context.font = '36px serif';
  const lines = wrapQuote(
    row.item.text,
    (text) => context.measureText(text).width,
  );
  const pages = Math.max(1, Math.ceil(lines.length / 24));
  const result: Blob[] = [];
  for (let page = 0; page < pages; page++) {
    const slice = lines.slice(page * 24, (page + 1) * 24);
    canvas.height = Math.max(700, slice.length * 58 + 300);
    context.fillStyle = '#F5F0E6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#2B2B2B';
    context.font = '36px serif';
    slice.forEach((text, index) =>
      context.fillText(text, 90, 120 + index * 58),
    );
    context.font = '24px sans-serif';
    const source = `${row.title} · ${row.chapterTitle}`;
    context.fillText(source, 90, canvas.height - 115, 820);
    context.fillText(
      t('微光阅读 · {0} / {1}', page + 1, pages),
      90,
      canvas.height - 65,
    );
    result.push(
      await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error(t('无法生成图片。'))),
          'image/png',
        ),
      ),
    );
  }
  return result;
}
