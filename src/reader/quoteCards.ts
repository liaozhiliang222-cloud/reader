import type { ReviewNote } from './notesReview';
/** Each page preserves complete quote text; long excerpts split into numbered images. */
export async function quoteCards(row: ReviewNote): Promise<Blob[]> {
  if (row.item.text.length > 20000)
    throw new Error('摘录超过 2 万字，请使用 Markdown 导出保存完整内容。');
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成摘录图片。');
  context.font = '36px serif';
  const lines: string[] = [];
  let line = '';
  for (const char of [...row.item.text]) {
    if (char === '\n' || context.measureText(line + char).width > 820) {
      lines.push(line);
      line = char === '\n' ? '' : char;
    } else line += char;
  }
  if (line) lines.push(line);
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
    context.fillText(`微光阅读 · ${page + 1} / ${pages}`, 90, canvas.height - 65);
    result.push(
      await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('无法生成图片。')),
          'image/png',
        ),
      ),
    );
  }
  return result;
}
