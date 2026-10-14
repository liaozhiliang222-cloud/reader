import { expect, it } from 'vitest';
import { SpeechFollow } from './follow';
import type { NativeSpeechSnapshot } from './SpeechBackend';

const snapshot: NativeSpeechSnapshot = {
  protocolVersion: 1,
  bookId: 'book',
  sessionId: 'session',
  leaseId: 'lease',
  contentRevision: 0,
  generation: 0,
  sequence: 1,
  state: 'speaking',
  currentSentence: 3,
  resumeLocator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 40 },
  sourceRanges: [
    {
      start: { chapterIndex: 0, paragraphIndex: 0, charOffset: 40 },
      end: { chapterIndex: 0, paragraphIndex: 0, charOffset: 50 },
    },
  ],
  stopReason: null,
  rate: 1,
  timer: 'off',
};
const input = {
  bookId: 'book',
  snapshot,
  detached: false,
  visible: true,
  active: true,
};
it('逐句状态变化不重复跳页，用户浏览后继续同一句立即回到朗读位置', () => {
  const follow = new SpeechFollow();
  expect(follow.update(input)?.jump).toEqual(snapshot.resumeLocator);
  expect(
    follow.update({ ...input, snapshot: { ...snapshot, sequence: 2 } })?.jump,
  ).toBeUndefined();
  expect(follow.update({ ...input, detached: true })?.ranges).toEqual([]);
  expect(
    follow.update({
      ...input,
      snapshot: { ...snapshot, state: 'paused', sequence: 3 },
    })?.jump,
  ).toEqual(snapshot.resumeLocator);
});
it('隐藏时不操作 DOM，回前台重新对齐一次；另一本文本不接受旧高亮', () => {
  const follow = new SpeechFollow();
  follow.update(input);
  expect(follow.update({ ...input, visible: false })).toBeUndefined();
  expect(follow.update(input)?.jump).toEqual(snapshot.resumeLocator);
  expect(follow.update({ ...input, bookId: 'other' })).toEqual({ ranges: [] });
});
it('新许可接管同一句也需对齐，停止状态清高亮并可恢复可靠定位', () => {
  const follow = new SpeechFollow();
  follow.update(input);
  expect(
    follow.update({ ...input, snapshot: { ...snapshot, leaseId: 'new-lease' } })
      ?.jump,
  ).toEqual(snapshot.resumeLocator);
  expect(
    follow.update({
      ...input,
      active: false,
      snapshot: { ...snapshot, state: 'stopped' },
    })?.ranges,
  ).toEqual([]);
});
