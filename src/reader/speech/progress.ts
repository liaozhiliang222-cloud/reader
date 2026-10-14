import type { Progress } from '@/types';
import {
  validIdentity,
  validLocator,
  validSnapshot,
  type SpeechIdentity,
  type SpeechSnapshot,
} from './protocol';

/** Device-local transaction record; never export this with a backup.
 * The database adapter must atomically compare leaseId, book revision and baseline.
 * A fresh leaseId is mandatory on each explicit takeover, including same-session resume. */
export interface SpeechProgressLease {
  leaseId: string;
  sessionId: string;
  bookId: string;
  contentRevision: number;
  generation: number;
  sequence: number;
  baseline: Progress | null;
  receipt: string | null;
  owner: 'speech' | 'reader';
}

export function sameProgress(a: Progress | null, b: Progress | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.bookId === b.bookId &&
      a.locator.chapterIndex === b.locator.chapterIndex &&
      a.locator.paragraphIndex === b.locator.paragraphIndex &&
      a.locator.charOffset === b.locator.charOffset &&
      a.percent === b.percent &&
      a.updatedAt === b.updatedAt)
  );
}

export function claimSpeechProgress(
  identity: SpeechIdentity,
  baseline: Progress | null,
  leaseId: string,
): SpeechProgressLease {
  if (
    !validIdentity(identity) ||
    !/^[a-zA-Z0-9_-]{1,96}$/.test(leaseId) ||
    (baseline !== null && baseline.bookId !== identity.bookId)
  )
    throw new Error('听书进度会话无效。');
  return {
    leaseId,
    sessionId: identity.sessionId,
    bookId: identity.bookId,
    contentRevision: identity.contentRevision,
    generation: identity.generation,
    sequence: -1,
    baseline: baseline && structuredClone(baseline),
    receipt: null,
    owner: 'speech',
  };
}

export type SpeechProgressResult =
  | { kind: 'apply'; lease: SpeechProgressLease; progress: Progress }
  | { kind: 'duplicate' }
  | {
      kind: 'ignore';
      reason: 'invalid' | 'session' | 'detached' | 'stale' | 'conflict';
    };

/** Pure half of the CAS transaction, independent of clocks and persistence.
 * A duplicate is ACK-safe only while the exact previously committed baseline remains.
 * The adapter checks the sentence locator against the stored chapter before calling. */
export function reconcileSpeechProgress(
  lease: SpeechProgressLease,
  snapshot: SpeechSnapshot,
  current: Progress | null,
  progress: Progress,
): SpeechProgressResult {
  if (
    !validSnapshot(snapshot) ||
    progress.bookId !== snapshot.bookId ||
    !validLocator(progress.locator) ||
    !Number.isFinite(progress.updatedAt) ||
    !Number.isFinite(progress.percent) ||
    progress.percent < 0 ||
    progress.percent > 100
  )
    return { kind: 'ignore', reason: 'invalid' };
  if (
    snapshot.sessionId !== lease.sessionId ||
    snapshot.bookId !== lease.bookId ||
    snapshot.contentRevision !== lease.contentRevision
  )
    return { kind: 'ignore', reason: 'session' };
  if (lease.owner !== 'speech') return { kind: 'ignore', reason: 'detached' };
  if (
    snapshot.generation < lease.generation ||
    snapshot.sequence < lease.sequence
  )
    return { kind: 'ignore', reason: 'stale' };
  if (!sameProgress(lease.baseline, current))
    return { kind: 'ignore', reason: 'conflict' };
  // Explicit fields make JSON property order irrelevant; updatedAt is not part
  // of the receipt so retrying a commit after an ACK loss is idempotent.
  const receipt = JSON.stringify([
    snapshot.generation,
    snapshot.sequence,
    snapshot.state,
    snapshot.currentSentence,
    snapshot.resumeLocator.chapterIndex,
    snapshot.resumeLocator.paragraphIndex,
    snapshot.resumeLocator.charOffset,
    snapshot.sourceRanges.map((r) => [r.start.charOffset, r.end.charOffset]),
    snapshot.stopReason,
    snapshot.rate,
    snapshot.timer,
    progress.locator.chapterIndex,
    progress.locator.paragraphIndex,
    progress.locator.charOffset,
    progress.percent,
  ]);
  if (snapshot.sequence === lease.sequence)
    return lease.receipt === receipt
      ? { kind: 'duplicate' }
      : { kind: 'ignore', reason: 'conflict' };
  return {
    kind: 'apply',
    lease: {
      ...lease,
      generation: snapshot.generation,
      sequence: snapshot.sequence,
      baseline: structuredClone(progress),
      receipt,
    },
    progress: structuredClone(progress),
  };
}
