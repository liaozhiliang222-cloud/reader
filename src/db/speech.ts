import { t } from '@/i18n';
import { db } from './index';
import { contentRevision } from './revision';
import { clampLocator, percentOf } from '@/reader/position';
import { sameLocator } from './bookmarks';
import {
  claimSpeechProgress,
  reconcileSpeechProgress,
  type SpeechProgressLease,
} from '@/reader/speech/progress';
import type { SpeechIdentity, SpeechSnapshot } from '@/reader/speech/protocol';
import type { Locator } from '@/types';

export interface StoredSpeechLease extends SpeechProgressLease {
  endLocator: Locator;
  wholeBook: boolean;
}
/** Only call after the native authority confirms there is no live service/preparation. */
export const releaseOrphanedSpeech = (database = db) =>
  database.speech.toCollection().modify({ owner: 'reader' });
export async function claimSpeech(
  identity: SpeechIdentity,
  endLocator: Locator,
  wholeBook: boolean,
  database = db,
) {
  return database.transaction(
    'rw',
    database.books,
    database.progress,
    database.speech,
    async () => {
      const book = await database.books.get(identity.bookId);
      if (
        !book ||
        book.missingFile ||
        contentRevision(book) !== identity.contentRevision
      )
        throw new Error(t('书籍内容已变化，请重新打开后听书。'));
      const lease: StoredSpeechLease = {
        ...claimSpeechProgress(
          identity,
          (await database.progress.get(book.id)) ?? null,
          crypto.randomUUID(),
        ),
        endLocator,
        wholeBook,
      };
      await database.speech.put(lease);
      return lease;
    },
  );
}
export async function releaseSpeech(
  bookId: string,
  leaseId: string,
  database = db,
) {
  await database.transaction('rw', database.speech, async () => {
    const lease = await database.speech.get(bookId);
    if (lease?.leaseId === leaseId)
      await database.speech.update(bookId, { owner: 'reader' });
  });
}
export async function saveSpeechSnapshot(
  snapshot: SpeechSnapshot & { leaseId: string },
  database = db,
) {
  return database.transaction(
    'rw',
    database.books,
    database.chapters,
    database.progress,
    database.speech,
    async () => {
      const book = await database.books.get(snapshot.bookId);
      const lease = await database.speech.get(snapshot.bookId);
      if (
        !book ||
        !lease ||
        lease.leaseId !== snapshot.leaseId ||
        contentRevision(book) !== snapshot.contentRevision
      )
        return 'session' as const;
      const locator =
        snapshot.state === 'ended' ? lease.endLocator : snapshot.resumeLocator;
      const chapter = await database.chapters.get([
        book.id,
        locator.chapterIndex,
      ]);
      if (!chapter || !sameLocator(clampLocator(chapter, locator), locator))
        throw new Error(t('听书位置与正文不一致，请重新准备。'));
      const current = (await database.progress.get(book.id)) ?? null;
      const result = reconcileSpeechProgress(lease, snapshot, current, {
        bookId: book.id,
        locator,
        percent:
          snapshot.state === 'ended' && lease.wholeBook
            ? 100
            : percentOf(chapter, locator, book.charCount),
        updatedAt: Date.now(),
      });
      if (result.kind === 'ignore') return result.reason;
      if (result.kind === 'apply') {
        await database.progress.put(result.progress);
        await database.speech.put({ ...lease, ...result.lease });
        await database.books.update(book.id, {
          lastReadAt: result.progress.updatedAt,
        });
      }
      return 'saved' as const;
    },
  );
}
