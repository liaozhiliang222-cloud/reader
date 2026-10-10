import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  AppSettings,
  Book,
  Bookmark,
  Highlight,
  Progress,
  StoredChapter,
} from '@/types';

export function createDatabase(name = 'jingye') {
  const database = new Dexie(name) as Dexie & {
    books: EntityTable<Book, 'id'>;
    chapters: Table<StoredChapter, [string, number]>;
    progress: EntityTable<Progress, 'bookId'>;
    blobs: EntityTable<{ id: string; data: Blob }, 'id'>;
    bookmarks: EntityTable<Bookmark, 'id'>;
    highlights: EntityTable<Highlight, 'id'>;
    settings: EntityTable<{ id: 'global'; value: AppSettings }, 'id'>;
  };
  const version1 = {
    books: 'id,lastReadAt,importedAt',
    chapters: '[bookId+index],bookId',
    progress: 'bookId',
    blobs: 'id',
  };
  database.version(1).stores(version1);
  database
    .version(2)
    .stores({
      ...version1,
      bookmarks: 'id,bookId,[bookId+createdAt]',
      highlights: 'id,bookId,[bookId+chapterIndex]',
      settings: 'id',
    })
    .upgrade(async (transaction) => {
      await transaction
        .table<Book>('books')
        .toCollection()
        .modify((book) => {
          if (book.type !== 'paste' && !book.fileBlobId)
            book.fileBlobId = book.id;
        });
    });
  return database;
}
