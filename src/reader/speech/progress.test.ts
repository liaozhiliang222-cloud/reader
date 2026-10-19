import { describe, expect, it } from 'vitest';
import type { Progress } from '@/types';
import {
  claimSpeechProgress,
  reconcileSpeechProgress,
  sameProgress,
} from './progress';
import { validIdentity, validSnapshot, type SpeechSnapshot } from './protocol';

const locator = (charOffset: number) => ({
  chapterIndex: 0,
  paragraphIndex: 0,
  charOffset,
});
const snapshot: SpeechSnapshot = {
  protocolVersion: 1,
  sessionId: 'session-a',
  bookId: 'book',
  contentRevision: 0,
  generation: 0,
  sequence: 1,
  state: 'speaking',
  currentSentence: 0,
  resumeLocator: locator(10),
  sourceRanges: [{ start: locator(10), end: locator(20) }],
  stopReason: null,
  rate: 1,
  timer: 'off',
};
const progress: Progress = {
  bookId: 'book',
  locator: locator(0),
  percent: 0,
  updatedAt: 10000,
};
const next: Progress = { ...progress, locator: locator(10), percent: 10 };
const claim = () => claimSpeechProgress(snapshot, progress, 'lease-a');

describe('听书进度事务决策', () => {
  it('按原生序列前进，时钟倒退仍可保存；不会改写传入对象', () => {
    const lease = claim();
    const result = reconcileSpeechProgress(lease, snapshot, progress, {
      ...next,
      updatedAt: 1,
    });
    expect(result.kind).toBe('apply');
    if (result.kind !== 'apply') throw new Error('missing commit');
    expect(result.lease.baseline?.updatedAt).toBe(1);
    expect(result.progress.locator.charOffset).toBe(10);
    result.progress.locator.charOffset = 999;
    expect(result.lease.baseline?.locator.charOffset).toBe(10);
    expect(lease.sequence).toBe(-1);
    expect(progress.locator.charOffset).toBe(0);
  });

  it('提交后 ACK 前崩溃重试可确认，但相同序号异内容拒绝', () => {
    const result = reconcileSpeechProgress(claim(), snapshot, progress, next);
    if (result.kind !== 'apply') throw new Error('missing commit');
    expect(
      reconcileSpeechProgress(result.lease, snapshot, next, {
        ...next,
        updatedAt: 3,
      }),
    ).toEqual({ kind: 'duplicate' });
    expect(
      reconcileSpeechProgress(
        result.lease,
        { ...snapshot, state: 'paused' },
        next,
        next,
      ),
    ).toEqual({ kind: 'ignore', reason: 'conflict' });
  });

  it('较旧代次与乱序快照均拒绝；新快照只同步最新句', () => {
    const newer = { ...snapshot, generation: 4, sequence: 10 };
    const result = reconcileSpeechProgress(claim(), newer, progress, next);
    if (result.kind !== 'apply') throw new Error('missing commit');
    for (const value of [
      { ...newer, generation: 3, sequence: 11 },
      { ...newer, generation: 5, sequence: 9 },
    ])
      expect(reconcileSpeechProgress(result.lease, value, next, next)).toEqual({
        kind: 'ignore',
        reason: 'stale',
      });
    expect(
      reconcileSpeechProgress(
        result.lease,
        { ...newer, sequence: 80 },
        next,
        next,
      ).kind,
    ).toBe('apply');
  });

  it('同时间戳的人工新位置优先，已有提交也不能被错误 ACK', () => {
    const changed = { ...progress, locator: locator(3) };
    expect(reconcileSpeechProgress(claim(), snapshot, changed, next)).toEqual({
      kind: 'ignore',
      reason: 'conflict',
    });
    const result = reconcileSpeechProgress(claim(), snapshot, progress, next);
    if (result.kind !== 'apply') throw new Error('missing commit');
    expect(
      reconcileSpeechProgress(result.lease, snapshot, changed, next),
    ).toEqual({ kind: 'ignore', reason: 'conflict' });
  });

  it('手动浏览移交后拒绝旧快照；显式继续产生新的写入许可', () => {
    const released = { ...claim(), owner: 'reader' as const };
    expect(reconcileSpeechProgress(released, snapshot, progress, next)).toEqual(
      { kind: 'ignore', reason: 'detached' },
    );
    const resumed = claimSpeechProgress(snapshot, next, 'lease-resumed');
    expect(resumed.leaseId).not.toBe(released.leaseId);
    expect(reconcileSpeechProgress(resumed, snapshot, next, next).kind).toBe(
      'apply',
    );
  });

  it('删除重导后的新会话、内容修订与其他书均不能接收旧位置', () => {
    for (const changes of [
      { sessionId: 'session-b' },
      { bookId: 'other' },
      { contentRevision: 1 },
    ])
      expect(
        reconcileSpeechProgress(
          { ...claim(), ...changes },
          snapshot,
          progress,
          next,
        ),
      ).toEqual({ kind: 'ignore', reason: 'session' });
  });

  it('初次无进度可写入，空基线不会等同于已有进度', () => {
    const lease = claimSpeechProgress(snapshot, null, 'first');
    expect(reconcileSpeechProgress(lease, snapshot, null, next).kind).toBe(
      'apply',
    );
    expect(reconcileSpeechProgress(lease, snapshot, progress, next)).toEqual({
      kind: 'ignore',
      reason: 'conflict',
    });
    expect(sameProgress(null, null)).toBe(true);
  });
});

describe('原生状态边界', () => {
  it('拒绝错误类型、非整数、未知协议/状态及错误范围', () => {
    expect(validIdentity(snapshot)).toBe(true);
    expect(validSnapshot(snapshot)).toBe(true);
    for (const value of [null, 1, {}, { ...snapshot, bookId: 123 }])
      expect(validIdentity(value)).toBe(false);
    for (const changes of [
      { protocolVersion: 2 },
      { generation: '2' },
      { sequence: NaN },
      { sequence: -1 },
      { state: 'invented' },
      { currentSentence: 0.5 },
      { rate: 1.01 },
      { timer: '5m' },
      { stopReason: {} },
      { resumeLocator: locator(2147483648) },
      { sourceRanges: [] },
      { sourceRanges: [{ start: locator(9), end: locator(20) }] },
      {
        sourceRanges: [
          { start: locator(10), end: locator(20) },
          { start: locator(19), end: locator(22) },
        ],
      },
    ])
      expect(validSnapshot({ ...snapshot, ...changes })).toBe(false);
  });
});
