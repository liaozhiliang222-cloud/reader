import { db } from './index';
export async function clearAllData(database = db) {
  await database.transaction('rw', database.tables, async () => {
    for (const table of database.tables) await table.clear();
  });
}
export async function dataCounts(database = db) {
  return database.transaction(
    'r',
    database.books,
    database.bookmarks,
    database.highlights,
    async () => ({
      books: await database.books.count(),
      bookmarks: await database.bookmarks.count(),
      highlights: await database.highlights.count(),
    }),
  );
}
