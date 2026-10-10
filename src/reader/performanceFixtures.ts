/** 自编、固定内容，测试及手动浏览器基准使用同一份千章样本。 */
export function thousandChapterText() {
  const body = Array.from({ length: 35 }, (_, index) =>
    `第${index}段，窗外的风轻轻吹过，读书的人翻开新的一页。`.repeat(5),
  ).join('\n');
  return Array.from(
    { length: 1000 },
    (_, index) => `第${index + 1}章 静夜\n${body}`,
  ).join('\n');
}
