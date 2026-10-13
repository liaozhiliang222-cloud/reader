import type { Locator } from '@/types';
import type { SourceRange } from './segment';
import type { NativeSpeechSnapshot } from './SpeechBackend';

/** Deduplicate sentence alignment while preserving an explicit return from browsing. */
export class SpeechFollow {
  private key = '';
  update(input: {
    bookId: string;
    snapshot?: NativeSpeechSnapshot;
    detached: boolean;
    visible: boolean;
    active: boolean;
  }): { jump?: Locator; ranges: SourceRange[] } | undefined {
    if (!input.visible) {
      this.key = '';
      return;
    }
    const snapshot = input.snapshot;
    if (!snapshot || snapshot.bookId !== input.bookId || input.detached) {
      this.key = '';
      return { ranges: [] };
    }
    const locator = snapshot.resumeLocator;
    const key = `${snapshot.sessionId}:${snapshot.leaseId}:${locator.chapterIndex}:${locator.paragraphIndex}:${locator.charOffset}`;
    const jump = key !== this.key ? { ...locator } : undefined;
    this.key = key;
    return { jump, ranges: input.active ? snapshot.sourceRanges : [] };
  }
}
