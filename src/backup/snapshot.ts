import { db } from '@/db';
import { initialSettings } from '@/app/settings';
import {
  BACKUP_VERSION,
  sourcePath,
  type BackupBook,
  type BackupSnapshot,
  type SnapshotSource,
} from './types';
export async function createSnapshot(
  kind: 'light' | 'full',
  database = db,
): Promise<BackupSnapshot> {
  return database.transaction(
    'r',
    [
      database.books,
      database.progress,
      database.bookmarks,
      database.highlights,
      database.settings,
      database.blobs,
    ],
    async () => {
      const loadBooks = async () => {
        const books: BackupBook[] = [],
          candidates: SnapshotSource[] = [];
        let after: string | undefined;
        const batchSize = 32;
        while (true) {
          const batch = await (
            after === undefined
              ? database.books.toCollection()
              : database.books.where('id').above(after)
          )
            .limit(batchSize)
            .toArray();
          for (const book of batch) {
            if (!book.missingFile)
              candidates.push({
                bookId: book.id,
                blobId:
                  book.type === 'paste'
                    ? (book.draftBlobId ?? '')
                    : (book.fileBlobId ?? book.id),
                size: book.size,
              });
            const meta = { ...book };
            delete meta.fileBlobId;
            delete meta.coverBlobId;
            delete meta.draftBlobId;
            delete meta.toc;
            delete meta.chapterSummaries;
            books.push(meta);
          }
          if (batch.length < batchSize) return { books, candidates };
          after = batch.at(-1)!.id;
        }
      };
      const [loaded, progress, bookmarks, highlights, saved] =
        await Promise.all([
          loadBooks(),
          database.progress.toArray(),
          database.bookmarks.toArray(),
          database.highlights.toArray(),
          database.settings.get('global'),
        ]);
      const { books, candidates } = loaded;
      const defaults = initialSettings(),
        exportedAt = Date.now();
      const settings = {
        ...defaults,
        ...saved?.value,
        reading: { ...defaults.reading, ...saved?.value.reading },
      };
      if (
        settings.lastBookId &&
        !books.some((book) => book.id === settings.lastBookId)
      )
        settings.lastBookId = undefined;
      const sources: BackupSnapshot['sources'] = [],
        files: BackupSnapshot['backup']['files'] = [];
      const metadata = new Map(books.map((book) => [book.id, book]));
      if (kind === 'full')
        for (const source of candidates) {
          // Inspect only the key during the snapshot transaction. A later
          // single-book callback fetches and verifies the immutable original.
          const exists = await database.blobs
            .where('id')
            .equals(source.blobId)
            .primaryKeys();
          if (exists.length) {
            sources.push(source);
            const book = metadata.get(source.bookId)!;
            files.push({ bookId: book.id, path: sourcePath(book) });
          }
        }
      return {
        backup: {
          app: 'jingye',
          schemaVersion: BACKUP_VERSION,
          exportedAt,
          kind,
          books,
          progress,
          bookmarks,
          highlights,
          settings,
          files,
        },
        sources,
      };
    },
  );
}

export async function readSnapshotOriginal(
  source: SnapshotSource,
  database = db,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const stored = await database.blobs.get(source.blobId);
  signal?.throwIfAborted();
  if (!stored || !(stored.data instanceof Blob))
    throw new Error('备份生成期间原文已不可用，请重新生成备份。');
  if (stored.data.size !== source.size)
    throw new Error('备份生成期间原文大小发生变化，请重新生成备份。');
  return stored.data;
}
