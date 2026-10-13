import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from './index';
import {
  claimSpeech,
  releaseSpeech,
  releaseOrphanedSpeech,
  saveSpeechSnapshot,
} from './speech';
import { deleteBook, saveProgress } from './repository';
import { createSnapshot } from '@/backup/snapshot';
import type { Book, Progress } from '@/types';
import type { NativeSpeechSnapshot } from '@/reader/speech/SpeechBackend';

const id = '0'.repeat(64);
const book: Book = {
  id,
  title: '原创',
  type: 'txt',
  charCount: 100,
  chapterCount: 1,
  importedAt: 1,
  lastReadAt: 1,
  size: 300,
};
const locator = (charOffset: number) => ({
  chapterIndex: 0,
  paragraphIndex: 0,
  charOffset,
});
const identity = {
  protocolVersion: 1 as const,
  sessionId: 'local-session',
  bookId: id,
  contentRevision: 0,
  generation: 0,
};
const progress: Progress = {
  bookId: id,
  locator: locator(0),
  percent: 0,
  updatedAt: 1,
};
const snapshot = (leaseId: string): NativeSpeechSnapshot => ({
  ...identity,
  leaseId,
  sequence: 1,
  state: 'speaking',
  currentSentence: 0,
  resumeLocator: locator(10),
  sourceRanges: [{ start: locator(10), end: locator(20) }],
  stopReason: null,
  rate: 1,
  timer: 'off',
});
beforeEach(async () => {
  await db.open();
  await db.books.put(book);
  await db.chapters.put({
    bookId: id,
    index: 0,
    title: '原创',
    paragraphs: ['字'.repeat(100)],
    charStart: 0,
    charCount: 100,
  });
  await db.progress.put(progress);
});
afterEach(async () => {
  await db.delete();
});
it('听书唯一写入权挡住页首 debounce，ACK 丢失重试幂等', async () => {
  const lease = await claimSpeech(identity, locator(100), true);
  await saveProgress({ ...progress, locator: locator(5), percent: 5 });
  expect((await db.progress.get(id))?.locator).toEqual(locator(0));
  const value = snapshot(lease.leaseId);
  expect(await saveSpeechSnapshot(value)).toBe('saved');
  expect((await db.progress.get(id))?.percent).toBe(10);
  const saved = await db.progress.get(id);
  expect(await saveSpeechSnapshot(value)).toBe('saved');
  expect(await db.progress.get(id)).toEqual(saved);
});
it('人工移交后旧快照不能覆盖，相同时间戳也保护人工定位', async () => {
  const lease = await claimSpeech(identity, locator(100), true);
  await saveSpeechSnapshot(snapshot(lease.leaseId));
  await releaseSpeech(id, lease.leaseId);
  const manual = { ...progress, locator: locator(75), percent: 75 };
  await saveProgress(manual);
  expect(
    await saveSpeechSnapshot({ ...snapshot(lease.leaseId), sequence: 2 }),
  ).toBe('detached');
  expect(await db.progress.get(id)).toEqual(manual);
});
it('删除重导同指纹及内容换版后拒绝原会话', async () => {
  const lease = await claimSpeech(identity, locator(100), true);
  await deleteBook(id);
  await db.books.put(book);
  expect(await saveSpeechSnapshot(snapshot(lease.leaseId))).toBe('session');
  const next = await claimSpeech(
    { ...identity, sessionId: 'new-session' },
    locator(100),
    true,
  );
  expect(next.leaseId).not.toBe(lease.leaseId);
  expect(await saveSpeechSnapshot(snapshot(lease.leaseId))).toBe('session');
  await db.books.update(id, { contentRevision: 1 });
  expect(
    await saveSpeechSnapshot({
      ...snapshot(next.leaseId),
      sessionId: 'new-session',
    }),
  ).toBe('session');
});
it('全书完毕才记 100%；本章队列只保存该章终点', async () => {
  const lease = await claimSpeech(identity, locator(100), true);
  expect(
    await saveSpeechSnapshot({ ...snapshot(lease.leaseId), state: 'ended' }),
  ).toBe('saved');
  expect((await db.progress.get(id))?.percent).toBe(100);
  const chapterLease = await claimSpeech(identity, locator(50), false);
  await saveSpeechSnapshot({
    ...snapshot(chapterLease.leaseId),
    state: 'ended',
  });
  expect((await db.progress.get(id))?.percent).toBe(50);
});
it('备份不导出本机听书会话和进度许可', async () => {
  const lease = await claimSpeech(identity, locator(100), true);
  const backup = await createSnapshot('light');
  expect(JSON.stringify(backup)).not.toContain(lease.leaseId);
  expect(JSON.stringify(backup)).not.toContain(identity.sessionId);
  expect(backup.backup.settings.speech).toEqual({ rate: 1, timer: 'off' });
});
it('准备接管后进程退出且没有原生会话时，清除残留写入锁并允许人工保存', async () => {
  await claimSpeech(identity, locator(100), true);
  await releaseOrphanedSpeech();
  const manual = { ...progress, locator: locator(25), percent: 25 };
  await saveProgress(manual);
  expect(await db.progress.get(id)).toEqual(manual);
});
