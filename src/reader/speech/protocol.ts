import type { Locator } from '@/types';
import type { SpeechSentence, SourceRange } from './segment';

// Initial T0 limits. Freeze against measured bridge/queue performance at TTS-02.
export const SPEECH_PROTOCOL = 1;
export const SPEECH_LIMITS = {
  batchBytes: 128 * 1024,
  batchSentences: 256,
  queueBytes: 64 * 1024 * 1024,
  sentenceUnits: 120,
} as const;
export interface SpeechIdentity {
  protocolVersion: typeof SPEECH_PROTOCOL;
  sessionId: string;
  bookId: string;
  contentRevision: number;
  generation: number;
}
export interface SpeechBatch extends SpeechIdentity {
  batchIndex: number;
  firstSentenceIndex: number;
  sentences: SpeechSentence[];
  final: boolean;
}
export type SpeechTimer = 'off' | '15m' | '30m' | '60m' | 'chapter';
export type SpeechStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'paused'
  | 'ended'
  | 'stopped'
  | 'error';
export interface SpeechSnapshot extends SpeechIdentity {
  sequence: number;
  state: SpeechStatus;
  currentSentence: number;
  resumeLocator: Locator;
  sourceRanges: SourceRange[];
  stopReason: string | null;
  rate: number;
  timer: SpeechTimer;
}

export const utf8Size = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** No coercion of floats, NaN, negative values, or strings at the bridge boundary. */
export function validLocator(value: unknown): value is Locator {
  if (!value || typeof value !== 'object') return false;
  return ['chapterIndex', 'paragraphIndex', 'charOffset'].every((key) => {
    const field = Reflect.get(value, key);
    return (
      typeof field === 'number' &&
      Number.isSafeInteger(field) &&
      field >= 0 &&
      field <= 2147483647
    );
  });
}
export function validIdentity(value: unknown): value is SpeechIdentity {
  if (!value || typeof value !== 'object') return false;
  const protocolVersion: unknown = Reflect.get(value, 'protocolVersion');
  const sessionId: unknown = Reflect.get(value, 'sessionId');
  const bookId: unknown = Reflect.get(value, 'bookId');
  const contentRevision: unknown = Reflect.get(value, 'contentRevision');
  const generation: unknown = Reflect.get(value, 'generation');
  return (
    protocolVersion === SPEECH_PROTOCOL &&
    typeof sessionId === 'string' &&
    /^[a-zA-Z0-9_-]{1,96}$/.test(sessionId) &&
    typeof bookId === 'string' &&
    bookId.length > 0 &&
    bookId.length <= 256 &&
    validCounter(contentRevision) &&
    validCounter(generation)
  );
}

export function validCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function validRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0.75 &&
    value <= 2 &&
    Math.abs(value * 20 - Math.round(value * 20)) < 0.000001
  );
}
export function validTimer(value: unknown): value is SpeechTimer {
  return ['off', '15m', '30m', '60m', 'chapter'].some((item) => item === value);
}

/** Reject malformed native/plugin results before they reach progress or DOM code. */
export function validSnapshot(value: unknown): value is SpeechSnapshot {
  if (!validIdentity(value)) return false;
  const field = (key: string): unknown => Reflect.get(value, key);
  const state = field('state');
  const resume = field('resumeLocator');
  const ranges = field('sourceRanges');
  const reason = field('stopReason');
  if (
    !validCounter(field('sequence')) ||
    !validCounter(field('currentSentence')) ||
    !['ready', 'speaking', 'paused', 'ended', 'stopped', 'error'].some(
      (item) => item === state,
    ) ||
    !validLocator(resume) ||
    !validRate(field('rate')) ||
    !validTimer(field('timer')) ||
    !(
      reason === null ||
      (typeof reason === 'string' && reason.length <= 256)
    ) ||
    !Array.isArray(ranges) ||
    ranges.length < 1 ||
    ranges.length > SPEECH_LIMITS.sentenceUnits
  )
    return false;
  let previousEnd = resume.charOffset;
  for (const range of ranges as unknown[]) {
    if (!range || typeof range !== 'object') return false;
    const start: unknown = Reflect.get(range, 'start');
    const end: unknown = Reflect.get(range, 'end');
    if (
      !validLocator(start) ||
      !validLocator(end) ||
      start.chapterIndex !== resume.chapterIndex ||
      end.chapterIndex !== resume.chapterIndex ||
      start.paragraphIndex !== resume.paragraphIndex ||
      end.paragraphIndex !== resume.paragraphIndex ||
      start.charOffset < previousEnd ||
      end.charOffset <= start.charOffset
    )
      return false;
    if (range === ranges[0] && start.charOffset !== resume.charOffset)
      return false;
    previousEnd = end.charOffset;
  }
  return true;
}
