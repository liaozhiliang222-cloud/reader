import { expect, it } from 'vitest';
import { parseDraft, splitDraft } from './paste';

it('Markdown标题按层级分章，保留前言，清理空行与缩进', async () => {
  const draft = await parseDraft(
    '\n开场\n\n# 山色\r\n　甲乙\n\n## 小径\n  丙丁\n',
  );
  expect(draft.title).toBe('开场');
  expect(
    draft.chapters.map((c) => [c.title, c.level, c.paragraphs, c.charStart]),
  ).toEqual([
    ['前言', 0, ['开场'], 0],
    ['山色', 0, ['甲乙'], 2],
    ['小径', 1, ['丙丁'], 4],
  ]);
  expect(draft.charCount).toBe(6);
  expect(draft.toc[2]).toEqual({
    title: '小径',
    level: 1,
    chapterIndex: 2,
    paragraphIndex: 0,
  });
});
it('自动标题截断30个Unicode字符，书籍指纹只由正文决定', async () => {
  const text = '# ' + '😀'.repeat(40) + '\n内容';
  const one = await parseDraft(text),
    two = await parseDraft(text);
  expect([...one.title]).toHaveLength(30);
  expect(one.id).toBe(two.id);
  expect((await parseDraft(text + '改')).id).not.toBe(one.id);
  expect(one.id).toMatch(/^paste:[a-f0-9]{64}$/);
});
it('没有Markdown标题时复用网文/自动分段，正文保持纯文本', () => {
  expect(
    splitDraft('第一章\n<script>原样文字</script>')[0]?.paragraphs,
  ).toEqual(['<script>原样文字</script>']);
  expect(splitDraft('甲\n\n乙')[0]?.paragraphs).toEqual(['甲', '乙']);
  expect(splitDraft('### 小节\n甲')[0]?.level).toBe(2);
});
it('拒绝空白文本，10万字不丢段落', async () => {
  await expect(parseDraft(' \n　\t')).rejects.toThrow('请先粘贴');
  const text = Array.from({ length: 1000 }, () => '文'.repeat(100)).join('\n');
  const result = await parseDraft(text);
  expect(result.charCount).toBe(100000);
  expect(result.chapters.reduce((n, c) => n + c.paragraphs.length, 0)).toBe(
    1000,
  );
});
