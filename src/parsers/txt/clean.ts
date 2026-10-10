/** 保留段内空格与标点，只统一换行、清理段首缩进和空行。 */
export function cleanParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[\s\u3000]+/u, '').trimEnd())
    .filter((line) => line.length > 0);
}
