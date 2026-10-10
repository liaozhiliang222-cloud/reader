import { describe, expect, it } from 'vitest';
import { cleanParagraphs } from './clean';
import { isChapterTitle, splitChapters } from './chapters';

describe('清洗与章节切分', () => {
  it('统一换行和缩进但保留段内空格', () => {
    expect(cleanParagraphs('　 甲  乙\r\n\r\n\t丙\r 丁  \n')).toEqual([
      '甲  乙',
      '丙',
      '丁',
    ]);
  });
  it.each([
    '第一章 静夜',
    '第一章静夜',
    '第12回风雪归人',
    '第十二回：重逢',
    '第２卷',
    'Chapter 12 Dawn',
    'CHAPTER 1',
    '序章',
    '番外：远行',
  ])('识别标题 %s', (title) => {
    expect(isChapterTitle(title)).toBe(true);
  });
  it.each([
    '第一次看见这本书',
    '第二部分的内容很长',
    '前言不搭后语',
    'Chapter 12days',
    '第十二章 ' + '字'.repeat(30),
  ])('不将正文 %s 当作标题', (line) => {
    expect(isChapterTitle(line)).toBe(false);
  });
  it('前置段落保留为前言，连续标题与末尾空章不丢失', () => {
    const chapters = splitChapters('导语\n第一章 起点\n甲乙\n第二章\n第三章');
    expect(
      chapters.map((c) => [c.title, c.paragraphs, c.charStart, c.charCount]),
    ).toEqual([
      ['前言', ['导语'], 0, 2],
      ['第一章 起点', ['甲乙'], 2, 2],
      ['第二章', [], 4, 0],
      ['第三章', [], 4, 0],
    ]);
  });
  it('无标题按段落边界约 5000 字切分，不截断超长段落', () => {
    const paragraphs = [
      '甲'.repeat(3000),
      '乙'.repeat(2100),
      '丙'.repeat(6000),
      '丁',
    ];
    const chapters = splitChapters(paragraphs.join('\n'));
    expect(chapters.map((c) => c.title)).toEqual([
      '第 1 部分',
      '第 2 部分',
      '第 3 部分',
    ]);
    expect(chapters.flatMap((c) => c.paragraphs)).toEqual(paragraphs);
    expect(chapters.map((c) => c.charStart)).toEqual([0, 5100, 11100]);
  });
  it('空文本不产生假章节', () => expect(splitChapters(' \r\n　')).toEqual([]));
  it('10MB 千章合成书章节、抽样内容及字符偏移正确', () => {
    const body = '窗外的风轻轻吹过，读书的人翻开新的一页。'.repeat(200);
    const text = Array.from(
      { length: 1000 },
      (_, i) => `第${i + 1}章 静夜\n${body}`,
    ).join('\n');
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(
      10 * 1024 * 1024,
    );
    const start = performance.now();
    const chapters = splitChapters(text);
    console.info(`千章解析基线：${Math.round(performance.now() - start)} ms`);
    expect(chapters).toHaveLength(1000);
    for (let index = 0; index < 1000; index += 100) {
      expect(chapters[index]).toEqual({
        index,
        title: `第${index + 1}章 静夜`,
        paragraphs: [body],
        charStart: index * body.length,
        charCount: body.length,
      });
    }
  });
});
