import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from './index';
import {
  addHighlight,
  listHighlights,
  removeHighlight,
  updateHighlight,
} from './highlights';
const span = {
  chapterIndex: 0,
  start: { paragraphIndex: 0, charOffset: 2 },
  end: { paragraphIndex: 1, charOffset: 2 },
};
beforeEach(async () => {
  await db.open();
  await db.books.add({
    id: 'b',
    title: '书',
    type: 'txt',
    charCount: 7,
    chapterCount: 1,
    importedAt: 1,
    lastReadAt: 1,
    size: 1,
  });
  await db.chapters.add({
    bookId: 'b',
    index: 0,
    title: '章',
    paragraphs: ['甲😀乙', '丙丁戊'],
    charStart: 0,
    charCount: 7,
  });
});
afterEach(async () => {
  await db.delete();
});
it('跨段与代理对范围取数据库原文，不信任调用者摘录；并发重复去重并保留笔记', async () => {
  const [a, b] = await Promise.all([
    addHighlight('b', span, 'red', ' 想法 '),
    addHighlight('b', span, 'blue'),
  ]);
  expect(a.id).toBe(b.id);
  expect(b.text).toBe('😀乙\n丙丁');
  expect(b.start.charOffset).toBe(1);
  expect(b.note).toBe('想法');
  expect(await db.highlights.count()).toBe(1);
  const [color] = await Promise.all([
    updateHighlight('b', a.id, { color: 'yellow' }),
    updateHighlight('b', a.id, { note: '新笔记' }),
  ]);
  expect(color.createdAt).toBe(a.createdAt);
  expect((await listHighlights('b'))[0]).toMatchObject({
    color: 'yellow',
    note: '新笔记',
  });
  await updateHighlight('b', a.id, { note: '' });
  expect((await listHighlights('b'))[0]?.note).toBeUndefined();
  await removeHighlight('other', a.id);
  expect(await db.highlights.count()).toBe(1);
  await expect(
    updateHighlight('other', a.id, { color: 'red' }),
  ).rejects.toThrow('不存在');
  await removeHighlight('b', a.id);
  expect(await db.highlights.count()).toBe(0);
});
it('空选区、越界和缺书不会留下记录', async () => {
  await expect(
    addHighlight('b', { ...span, end: span.start }, 'red'),
  ).rejects.toThrow('选区');
  await expect(
    addHighlight(
      'b',
      { ...span, end: { paragraphIndex: 8, charOffset: 0 } },
      'red',
    ),
  ).rejects.toThrow('选区');
  await expect(addHighlight('missing', span, 'red')).rejects.toThrow('不可用');
  expect(await db.highlights.count()).toBe(0);
});
it('存储异常回滚，不破坏书籍与正文', async () => {
  const fail = () => {
    throw new Error('quota');
  };
  db.highlights.hook('creating', fail);
  try {
    await expect(addHighlight('b', span, 'red', '笔记')).rejects.toThrow(
      'quota',
    );
  } finally {
    db.highlights.hook('creating').unsubscribe(fail);
  }
  expect(await db.highlights.count()).toBe(0);
  expect((await db.chapters.get(['b', 0]))?.paragraphs).toEqual([
    '甲😀乙',
    '丙丁戊',
  ]);
});
